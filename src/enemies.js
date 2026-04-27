// Enemy factory + AI loop. Four types: slime, goblin, archer, boss.
// Each has its own behavior block in updateEnemies().

import * as THREE from 'three';
import { state } from './state.js';
import { CELL, MAX_FLOOR } from './constants.js';
import { moveWithCollide } from './dungeon.js';
import { damagePlayer } from './combat.js';
import { spawnArrow } from './pickups.js';
import { SFX } from './audio.js';
import { spawnParticles } from './particles.js';
import { shake } from './scene.js';

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
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 10);
    const m = new THREE.MeshStandardMaterial({ color: 0xc04848, roughness: 0.5 });
    const b = new THREE.Mesh(bodyGeo, m);
    b.position.y = 0.4; b.castShadow = true;
    g.add(b);
    const headGeo = new THREE.SphereGeometry(0.28, 14, 10);
    const headM = new THREE.MeshStandardMaterial({ color: 0x88aa44 });
    const h = new THREE.Mesh(headGeo, headM); h.position.y = 1.0; h.castShadow = true;
    g.add(h);
    const eyeGeo = new THREE.SphereGeometry(0.05, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff44 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.1, 1.05, 0.22);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.1, 1.05, 0.22);
    g.add(eyeL); g.add(eyeR);
    g.userData.body = b;
    stats = {
      hp: 32, maxHp: 32, atk: 12, spd: 2.6, range: 1.4, atkCd: 0,
      type: 'goblin', radius: 0.5, color: 0xc04848,
      charging: false, chargeT: 0, chargeDirX: 0, chargeDirZ: 0,
    };
  } else if (type === 'archer') {
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.0, 10);
    const m = new THREE.MeshStandardMaterial({ color: 0xeeeedd, roughness: 0.6 });
    const b = new THREE.Mesh(bodyGeo, m);
    b.position.y = 0.5; b.castShadow = true;
    g.add(b);
    const headGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const headM = new THREE.MeshStandardMaterial({ color: 0xddddcc });
    const h = new THREE.Mesh(headGeo, headM); h.position.y = 1.15; h.castShadow = true;
    g.add(h);
    const eyeGeo = new THREE.SphereGeometry(0.05, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.08, 1.18, 0.18);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.08, 1.18, 0.18);
    g.add(eyeL); g.add(eyeR);
    g.userData.body = b;
    stats = {
      hp: 20, maxHp: 20, atk: 10, spd: 1.8, range: 7.0, atkCd: 0,
      type: 'archer', radius: 0.4, color: 0xeeeedd,
      shootCd: 0, retreatRange: 3.5,
    };
  } else if (type === 'boss') {
    const bodyGeo = new THREE.CylinderGeometry(0.7, 1.0, 1.6, 12);
    const m = new THREE.MeshStandardMaterial({
      color: 0x7a2020, roughness: 0.4, metalness: 0.2,
    });
    const b = new THREE.Mesh(bodyGeo, m);
    b.position.y = 0.8; b.castShadow = true;
    g.add(b);
    const headGeo = new THREE.SphereGeometry(0.55, 16, 12);
    const headM = new THREE.MeshStandardMaterial({ color: 0x441010, roughness: 0.5 });
    const h = new THREE.Mesh(headGeo, headM); h.position.y = 1.95; h.castShadow = true;
    g.add(h);

    const hornGeo = new THREE.ConeGeometry(0.1, 0.6, 8);
    const hornM = new THREE.MeshStandardMaterial({ color: 0xeeddcc });
    const hornL = new THREE.Mesh(hornGeo, hornM);
    hornL.position.set(-0.4, 2.15, 0.1); hornL.rotation.z = 0.5; hornL.castShadow = true;
    g.add(hornL);
    const hornR = new THREE.Mesh(hornGeo, hornM);
    hornR.position.set(0.4, 2.15, 0.1); hornR.rotation.z = -0.5; hornR.castShadow = true;
    g.add(hornR);

    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.18, 2.0, 0.45);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.18, 2.0, 0.45);
    g.add(eyeL); g.add(eyeR);

    const aura = new THREE.PointLight(0xff3333, 2.5, 10);
    aura.position.y = 1.5;
    g.add(aura);

    g.userData.body = b;
    g.userData.aura = aura;

    const bossHp = 280 + Math.max(0, floor - 5) * 40;
    stats = {
      hp: bossHp, maxHp: bossHp, atk: 18, spd: 1.8, range: 1.6, atkCd: 0,
      type: 'boss', radius: 1.0, color: 0x7a2020,
      charging: false, chargeT: 0, slamCd: 3.0, phase: 1, isBoss: true,
    };
  }

  // Difficulty scaling (boss is pre-tuned)
  if (!stats.isBoss) {
    const mult = 1 + (floor - 1) * 0.18;
    stats.hp = Math.round(stats.hp * mult);
    stats.maxHp = stats.hp;
    stats.atk = Math.round(stats.atk * mult);
  }

  g.position.set(x, 0, z);
  g.userData.stats = stats;
  g.userData.hurtT = 0;
  g.userData.hpBar = makeHpBar();
  g.userData.hpBar.position.y = stats.isBoss ? 2.7 : 1.6;
  g.add(g.userData.hpBar);
  return g;
}

/* ─── SPAWN ──────────────────────────────────────────────────── */

export function spawnEnemiesForFloor(floor) {
  state.enemies.length = 0;

  if (floor === MAX_FLOOR) {
    // Boss room: single boss in last room
    const r = state.rooms[state.rooms.length - 1];
    const e = makeEnemy('boss', r.cx * CELL, r.cz * CELL, floor);
    state.enemies.push(e);
    state.scene.add(e);
    SFX.bossRoar();
    return;
  }

  // Regular floor: enemies in non-starting rooms
  for (let i = 1; i < state.rooms.length; i++) {
    const r = state.rooms[i];
    const count = 1 + Math.floor(Math.random() * 2) + Math.floor(floor / 2);
    for (let j = 0; j < count; j++) {
      const types = floor >= 2 ? ['slime', 'goblin', 'archer'] : ['slime', 'goblin'];
      const t = types[Math.floor(Math.random() * types.length)];
      const ex = (r.x + Math.random() * r.w) * CELL;
      const ez = (r.z + Math.random() * r.h) * CELL;
      const e = makeEnemy(t, ex, ez, floor);
      state.enemies.push(e);
      state.scene.add(e);
    }
  }
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
        s.atkCd = 1.2;
      }
    } else if (s.type === 'goblin') {
      if (s.charging) {
        s.chargeT -= dt;
        const sp = (s.spd * 2.2) * dt;
        moveWithCollide(e, s.chargeDirX * sp, s.chargeDirZ * sp, s.radius);
        if (dist < 1.0 && s.atkCd <= 0) {
          damagePlayer(s.atk + 4);
          s.atkCd = 0.5;
          s.charging = false;
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
          s.atkCd = 1.0;
        }
        // Random charge tell
        if (dist < 8 && dist > 2 && Math.random() < 0.005 && s.atkCd <= 0) {
          s.charging = true;
          s.chargeT = 0.6;
          const l = Math.hypot(dx, dz);
          s.chargeDirX = dx / l;
          s.chargeDirZ = dz / l;
          if (e.userData.body) e.userData.body.material.emissive.setHex(0xff8800);
        }
      }
    } else if (s.type === 'archer') {
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
        s.shootCd = 1.6;
        SFX.arrow();
      }
    } else if (s.type === 'boss') {
      const hpRatio = s.hp / s.maxHp;
      if (s.phase === 1 && hpRatio < 0.66) { s.phase = 2; SFX.bossRoar(); shake(0.3, 0.6); }
      if (s.phase === 2 && hpRatio < 0.33) { s.phase = 3; SFX.bossRoar(); shake(0.4, 0.7); }
      const phaseSpd = 1 + (s.phase - 1) * 0.4;

      if (s.charging) {
        s.chargeT -= dt;
        const sp = (s.spd * 3.5 * phaseSpd) * dt;
        moveWithCollide(e, s.chargeDirX * sp, s.chargeDirZ * sp, s.radius);
        if (dist < 1.6 && s.atkCd <= 0) {
          damagePlayer(s.atk + 6);
          s.atkCd = 0.4;
          s.charging = false;
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
          s.atkCd = 1.0;
        }
        s.slamCd -= dt;
        if (s.slamCd <= 0 && dist < 14) {
          s.charging = true;
          s.chargeT = 1.0;
          const l = Math.hypot(dx, dz);
          s.chargeDirX = dx / l;
          s.chargeDirZ = dz / l;
          s.slamCd = 4.0 - s.phase * 0.6;
          spawnParticles(e.position.x, 1.5, e.position.z, 0xff5533, 12, 2.5);
        }
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
