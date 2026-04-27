// Enemy factory + AI loop. Four types: slime, goblin, archer, boss.
// Each has its own behavior block in updateEnemies().

import * as THREE from 'three';
import { state } from './state.js';
import { CELL, MAX_FLOOR, DIFFICULTIES } from './constants.js';
import { moveWithCollide } from './dungeon.js';
import { damagePlayer } from './combat.js';
import { spawnArrow } from './pickups.js';
import { SFX } from './audio.js';
import { spawnParticles } from './particles.js';
import { shake } from './scene.js';
import { instantiate, playOnly, createShadowDisc } from './assets.js';

// Quaternius models import facing +Z, matching the old primitive enemies.
// rotation.y = atan2(dx, dz) on the parent group already points them at the
// player without any additional offset.
const MODEL_FORWARD_OFFSET = 0;

/* ─── HP BARS ────────────────────────────────────────────────── */

function makeHpBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.7 }),
  );
  g.add(bg);
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );
  fg.position.z = 0.001;
  g.add(fg);
  g.userData.fg = fg;
  return g;
}

export function updateHpBar(enemy) {
  const stats = enemy.userData.stats;
  const fg = enemy.userData.hpBar.userData.fg;
  const ratio = Math.max(0, stats.hp / stats.maxHp);
  fg.scale.x = ratio;
  fg.position.x = -0.43 * (1 - ratio);
  enemy.userData.hpBar.lookAt(state.camera.position);
}

/* ─── MODEL HELPERS ──────────────────────────────────────────── */

// Clones a preloaded glTF, attaches it to `parent`, and stashes the mixer +
// actions on parent.userData so the AI can drive animations later. We expose
// `body` to keep the shared hurt-flash code working — for skinned models we
// mark the first SkinnedMesh found as `body`.
function attachModel(parent, name, scale) {
  const { root, mixer, actions } = instantiate(name);
  root.scale.setScalar(scale);
  root.rotation.y = MODEL_FORWARD_OFFSET;
  parent.add(root);

  // Fake grounding shadow — radius scales with the entity (bigger boss).
  parent.add(createShadowDisc(name === 'monk' ? 0.85 : 0.4));

  // SkeletonUtils.clone shares materials across instances, so flashing one
  // enemy red would flash every other enemy with the same model. Clone the
  // material on each meshed node so per-enemy hurt flashes stay isolated.
  let body = null;
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      if (!body) body = o;
    }
  });

  parent.userData.modelRoot = root;
  parent.userData.mixer = mixer;
  parent.userData.actions = actions;
  parent.userData.body = body;
  parent.userData.currentAnim = null;
}

export function setEnemyAnim(e, name, opts) {
  if (!e.userData.actions) return; // primitive entity (slime)
  if (e.userData.currentAnim === name) return;
  e.userData.currentAnim = name;
  playOnly(e.userData.actions, name, opts);
}

/* ─── FACTORY ────────────────────────────────────────────────── */

export function makeEnemy(type, x, z, floor) {
  const g = new THREE.Group();
  let stats;

  if (type === 'slime') {
    const bodyGeo = new THREE.SphereGeometry(0.55, 14, 10);
    bodyGeo.scale(1, 0.7, 1);
    const m = new THREE.MeshStandardMaterial({
      color: 0x55cc66, transparent: true, opacity: 0.85, roughness: 0.3,
    });
    const b = new THREE.Mesh(bodyGeo, m);
    b.position.y = 0.4; b.castShadow = true;
    g.add(b);
    const eyeGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111122 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.15, 0.55, 0.4);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.15, 0.55, 0.4);
    g.add(eyeL); g.add(eyeR);
    g.userData.body = b;
    stats = {
      hp: 18, maxHp: 18, atk: 8, spd: 1.6, range: 1.0, atkCd: 0,
      type: 'slime', radius: 0.55, color: 0x55cc66,
    };
  } else if (type === 'goblin') {
    attachModel(g, 'rogue', 0.45);
    stats = {
      hp: 32, maxHp: 32, atk: 12, spd: 2.6, range: 1.4, atkCd: 0,
      type: 'goblin', radius: 0.5, color: 0xc04848,
      charging: false, chargeT: 0, chargeDirX: 0, chargeDirZ: 0,
    };
  } else if (type === 'archer') {
    attachModel(g, 'ranger', 0.45);
    stats = {
      hp: 20, maxHp: 20, atk: 10, spd: 1.8, range: 7.0, atkCd: 0,
      type: 'archer', radius: 0.4, color: 0xeeeedd,
      shootCd: 0, retreatRange: 3.5,
    };
  } else if (type === 'boss') {
    attachModel(g, 'monk', 1.1); // scaled up — Monk is the boss
    const aura = new THREE.PointLight(0xff3333, 2.5, 10);
    aura.position.y = 1.8;
    g.add(aura);
    g.userData.aura = aura;

    const bossHp = 280 + Math.max(0, floor - 5) * 40;
    stats = {
      hp: bossHp, maxHp: bossHp, atk: 18, spd: 1.8, range: 1.6, atkCd: 0,
      type: 'boss', radius: 1.0, color: 0x7a2020,
      charging: false, chargeT: 0, slamCd: 3.0, phase: 1, isBoss: true,
    };
  }

  // Floor scaling (boss is pre-tuned).
  if (!stats.isBoss) {
    const mult = 1 + (floor - 1) * 0.18;
    stats.hp = Math.round(stats.hp * mult);
    stats.maxHp = stats.hp;
    stats.atk = Math.round(stats.atk * mult);
  }

  // Apply difficulty preset on top — both boss and regulars get scaled here
  // so easy mode is meaningfully easier including against the boss.
  const diff = DIFFICULTIES[state.pDifficultyKey] || DIFFICULTIES.medium;
  stats.hp = Math.max(1, Math.round(stats.hp * diff.enemyHpMul));
  stats.maxHp = stats.hp;
  stats.atk = Math.max(1, Math.round(stats.atk * diff.enemyAtkMul));
  // Stash the cooldown multiplier on the stats so updateEnemies' attack /
  // shoot cd assignments can use it without re-reading the global.
  stats.atkCdMul = diff.enemyAtkCdMul;

  g.position.set(x, 0, z);
  g.userData.stats = stats;
  g.userData.hurtT = 0;
  g.userData.hpBar = makeHpBar();
  g.userData.hpBar.position.y = stats.isBoss ? 2.7 : 1.6;
  g.add(g.userData.hpBar);
  return g;
}

/* ─── SPAWN ──────────────────────────────────────────────────── */

// Spawning all 10-20 skinned-mesh enemies in one frame on a floor change
// blew the frame budget (600ms+ INP spikes were observed). Build a list
// of "what to spawn" up front, then drain it across frames respecting a
// per-frame budget. Boss floor stays synchronous (just one entity).

let _spawnQueue = [];
let _spawnFloor = 0;
let _onSpawnComplete = null;

function buildEnemyDescriptors(floor) {
  const descs = [];
  for (let i = 1; i < state.rooms.length; i++) {
    const r = state.rooms[i];
    const count = 1 + Math.floor(Math.random() * 2) + Math.floor(floor / 2);
    for (let j = 0; j < count; j++) {
      const types = floor >= 2 ? ['slime', 'goblin', 'archer'] : ['slime', 'goblin'];
      const t = types[Math.floor(Math.random() * types.length)];
      const cellX = r.x + Math.floor(Math.random() * r.w);
      const cellZ = r.z + Math.floor(Math.random() * r.h);
      descs.push({ type: t, x: cellX * CELL, z: cellZ * CELL });
    }
  }
  return descs;
}

function processSpawnQueue() {
  // ~5ms budget per frame. Each makeEnemy clones a SkinnedMesh + builds
  // an AnimationMixer (~3ms each), so we get 1-2 enemies per frame.
  const budget = 5;
  const start = performance.now();
  while (_spawnQueue.length > 0 && (performance.now() - start) < budget) {
    const d = _spawnQueue.shift();
    const e = makeEnemy(d.type, d.x, d.z, _spawnFloor);
    state.enemies.push(e);
    state.scene.add(e);
  }
  if (_spawnQueue.length > 0) {
    requestAnimationFrame(processSpawnQueue);
  } else {
    const cb = _onSpawnComplete;
    _onSpawnComplete = null;
    if (cb) cb();
  }
}

export function pendingEnemyCount() {
  return _spawnQueue.length;
}

export function spawnEnemiesForFloor(floor, onComplete) {
  state.enemies.length = 0;
  _spawnQueue = [];
  _onSpawnComplete = onComplete || null;
  _spawnFloor = floor;

  if (floor === MAX_FLOOR) {
    // Boss room: single boss in last room — spawn synchronously.
    const r = state.rooms[state.rooms.length - 1];
    const e = makeEnemy('boss', r.cx * CELL, r.cz * CELL, floor);
    state.enemies.push(e);
    state.scene.add(e);
    SFX.bossRoar();
    if (_onSpawnComplete) { const cb = _onSpawnComplete; _onSpawnComplete = null; cb(); }
    return;
  }

  _spawnQueue = buildEnemyDescriptors(floor);
  processSpawnQueue();
}

/* ─── AI ─────────────────────────────────────────────────────── */

export function updateEnemies(dt) {
  for (const e of state.enemies) {
    const s = e.userData.stats;

    // Hurt flash (in-place setHex to avoid allocating a Color every frame)
    if (e.userData.hurtT > 0) {
      e.userData.hurtT -= dt;
      if (e.userData.body) e.userData.body.material.emissive.setHex(0xff4444);
    } else if (e.userData.body && e.userData.body.material.emissive) {
      e.userData.body.material.emissive.setHex(0x000000);
    }

    const dx = state.player.position.x - e.position.x;
    const dz = state.player.position.z - e.position.z;
    const dist = Math.hypot(dx, dz);
    s.atkCd = Math.max(0, s.atkCd - dt);

    if (s.type === 'slime') {
      if (dist < 14) {
        const sp = s.spd * dt;
        moveWithCollide(e, (dx / dist) * sp, (dz / dist) * sp, s.radius);
      }
      e.position.y = Math.abs(Math.sin(performance.now() * 0.005 + e.id)) * 0.15;
      if (dist < s.range + 0.3 && s.atkCd <= 0) {
        damagePlayer(s.atk);
        s.atkCd = 1.2 * s.atkCdMul;
      }
    } else if (s.type === 'goblin') {
      let didAttack = false;
      if (s.charging) {
        s.chargeT -= dt;
        const sp = (s.spd * 2.2) * dt;
        moveWithCollide(e, s.chargeDirX * sp, s.chargeDirZ * sp, s.radius);
        if (dist < 1.0 && s.atkCd <= 0) {
          damagePlayer(s.atk + 4);
          s.atkCd = 0.5 * s.atkCdMul;
          s.charging = false;
          setEnemyAnim(e, 'Dagger_Attack2', { loop: false, crossfade: 0.05 });
          didAttack = true;
        }
        if (s.chargeT <= 0) s.charging = false;
      } else {
        if (dist < 12) {
          const sp = s.spd * dt;
          moveWithCollide(e, (dx / dist) * sp, (dz / dist) * sp, s.radius);
          e.rotation.y = Math.atan2(dx, dz);
        }
        if (dist < s.range && s.atkCd <= 0) {
          damagePlayer(s.atk);
          s.atkCd = 1.0 * s.atkCdMul;
          setEnemyAnim(e, 'Dagger_Attack', { loop: false, crossfade: 0.05 });
          didAttack = true;
        }
        // Random charge tell. Guarded against l ~ 0 — if the goblin is
        // standing right on the player, the charge math would NaN out and
        // drift the entity off the grid.
        if (dist < 8 && dist > 2 && Math.random() < 0.005 && s.atkCd <= 0) {
          const l = Math.hypot(dx, dz);
          if (l > 0.01) {
            s.charging = true;
            s.chargeT = 0.6;
            s.chargeDirX = dx / l;
            s.chargeDirZ = dz / l;
            if (e.userData.body) e.userData.body.material.emissive.setHex(0xff8800);
          }
        }
      }
      if (!didAttack) {
        setEnemyAnim(e, dist < 12 ? 'Run' : 'Idle');
      }
    } else if (s.type === 'archer') {
      let didShoot = false;
      if (dist < s.retreatRange) {
        const sp = s.spd * dt;
        moveWithCollide(e, -(dx / dist) * sp, -(dz / dist) * sp, s.radius);
      } else if (dist > s.range) {
        const sp = s.spd * 0.7 * dt;
        moveWithCollide(e, (dx / dist) * sp, (dz / dist) * sp, s.radius);
      }
      e.rotation.y = Math.atan2(dx, dz);
      s.shootCd = Math.max(0, s.shootCd - dt);
      if (dist < s.range && dist > 1.5 && s.shootCd <= 0) {
        spawnArrow(e.position.x, e.position.z, dx / dist, dz / dist, s.atk);
        s.shootCd = 1.6 * s.atkCdMul;
        SFX.arrow();
        setEnemyAnim(e, 'Bow_Shoot', { loop: false, crossfade: 0.05 });
        didShoot = true;
      }
      if (!didShoot) {
        const moving = dist < s.retreatRange || dist > s.range;
        setEnemyAnim(e, moving ? 'Run_Holding' : 'Idle_Weapon');
      }
    } else if (s.type === 'boss') {
      const hpRatio = s.hp / s.maxHp;
      if (s.phase === 1 && hpRatio < 0.66) { s.phase = 2; SFX.bossRoar(); shake(0.3, 0.6); }
      if (s.phase === 2 && hpRatio < 0.33) { s.phase = 3; SFX.bossRoar(); shake(0.4, 0.7); }
      const phaseSpd = 1 + (s.phase - 1) * 0.4;

      let didAttack = false;
      if (s.charging) {
        s.chargeT -= dt;
        const sp = (s.spd * 3.5 * phaseSpd) * dt;
        moveWithCollide(e, s.chargeDirX * sp, s.chargeDirZ * sp, s.radius);
        if (dist < 1.6 && s.atkCd <= 0) {
          damagePlayer(s.atk + 6);
          s.atkCd = 0.4 * s.atkCdMul;
          s.charging = false;
          setEnemyAnim(e, 'Attack2', { loop: false, crossfade: 0.05 });
          didAttack = true;
        }
        if (s.chargeT <= 0) s.charging = false;
      } else {
        if (dist < 20) {
          const sp = s.spd * phaseSpd * dt;
          moveWithCollide(e, (dx / dist) * sp, (dz / dist) * sp, s.radius);
          e.rotation.y = Math.atan2(dx, dz);
        }
        if (dist < s.range + 0.4 && s.atkCd <= 0) {
          damagePlayer(s.atk);
          s.atkCd = 1.0 * s.atkCdMul;
          setEnemyAnim(e, 'Attack', { loop: false, crossfade: 0.05 });
          didAttack = true;
        }
        s.slamCd -= dt;
        if (s.slamCd <= 0 && dist < 14) {
          const l = Math.hypot(dx, dz);
          if (l > 0.01) {
            s.charging = true;
            s.chargeT = 1.0;
            s.chargeDirX = dx / l;
            s.chargeDirZ = dz / l;
            s.slamCd = 4.0 - s.phase * 0.6;
            spawnParticles(e.position.x, 1.5, e.position.z, 0xff5533, 12, 2.5);
          }
        }
      }
      if (!didAttack) {
        setEnemyAnim(e, dist < 20 ? 'Run' : 'Idle');
      }
      if (e.userData.aura) {
        e.userData.aura.intensity = 2.0
          + Math.sin(performance.now() * 0.01) * 0.6
          + s.phase * 0.4;
      }
    }

    updateHpBar(e);
  }
}
