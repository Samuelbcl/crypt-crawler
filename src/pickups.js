// Pickups (heart/sword/boots/gold) AND projectiles (arrows). They're together
// because both are "world objects that interact with the player on contact".

import * as THREE from 'three';
import { state } from './state.js';
import { CELL } from './constants.js';
import { isWallAt } from './dungeon.js';
import { damagePlayer, flashScreen } from './combat.js';
import { SFX } from './audio.js';
import { spawnParticles } from './particles.js';
import { showDmgNumber } from './ui.js';
import { disposeNode } from './scene.js';

/* ─── PICKUPS ────────────────────────────────────────────────── */

export function makePickup(type, x, z) {
  const g = new THREE.Group();
  let mesh, col;

  if (type === 'heart') {
    col = 0xff4477;
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 }),
    );
  } else if (type === 'sword') {
    col = 0xddddee;
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.5, 0.06),
      new THREE.MeshStandardMaterial({
        color: col, emissive: 0x6688aa, emissiveIntensity: 0.4, metalness: 0.7,
      }),
    );
  } else if (type === 'boots') {
    col = 0xffd966;
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.18, 0.25),
      new THREE.MeshStandardMaterial({ color: col, emissive: 0xaa7733, emissiveIntensity: 0.4 }),
    );
  } else { // gold
    col = 0xffcc33;
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16),
      new THREE.MeshStandardMaterial({
        color: col, emissive: 0xaa7700, emissiveIntensity: 0.6, metalness: 0.7,
      }),
    );
  }

  mesh.castShadow = true;
  mesh.position.y = 0.6;
  g.add(mesh);

  const pl = new THREE.PointLight(col, 0.5, 2.5);
  pl.position.y = 0.6;
  g.add(pl);

  g.position.set(x, 0, z);
  g.userData = { type, mesh, baseY: 0.6, t: Math.random() * Math.PI * 2 };
  return g;
}

export function spawnPickupsForFloor(floor) {
  for (const p of state.pickups) state.scene.remove(p);
  state.pickups.length = 0;

  // Only in non-start, non-final rooms
  for (let i = 1; i < state.rooms.length - 1; i++) {
    if (Math.random() >= 0.7) continue;
    const r = state.rooms[i];
    const x = (r.x + Math.random() * r.w) * CELL;
    const z = (r.z + Math.random() * r.h) * CELL;

    const roll = Math.random();
    let type;
    if (roll < 0.4) type = 'gold';
    else if (roll < 0.7) type = 'heart';
    else if (roll < 0.88) type = 'sword';
    else type = 'boots';

    const p = makePickup(type, x, z);
    state.pickups.push(p);
    state.scene.add(p);
  }
}

export function updatePickups(dt) {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    p.userData.t += dt;
    p.userData.mesh.position.y = p.userData.baseY + Math.sin(p.userData.t * 3) * 0.15;
    p.userData.mesh.rotation.y += dt * 1.5;

    const dx = p.position.x - state.player.position.x;
    const dz = p.position.z - state.player.position.z;
    if (Math.hypot(dx, dz) < 0.9) {
      applyPickup(p);
      state.scene.remove(p);
      disposeNode(p);
      state.pickups.splice(i, 1);
    }
  }
}

function applyPickup(p) {
  const t = p.userData.type;
  const px = state.player.position.x;
  const py = state.player.position.y + 1.8;
  const pz = state.player.position.z;

  if (t === 'heart') {
    state.pStats.hp = Math.min(state.pStats.maxHp, state.pStats.hp + 25);
    SFX.heart();
    flashScreen('heal');
    showDmgNumber(px, py, pz, 25, '#66ff88');
  } else if (t === 'sword') {
    state.pStats.atk += 4;
    state.pStats.maxHp += 5;
    state.pStats.hp = Math.min(state.pStats.maxHp, state.pStats.hp + 5);
    SFX.pickup();
  } else if (t === 'boots') {
    state.pStats.spd = Math.min(2.0, state.pStats.spd + 0.15);
    SFX.pickup();
  } else {
    const amt = 5 + Math.floor(Math.random() * 8);
    state.pStats.gold += amt;
    state.totalGold += amt;
    SFX.pickup();
    showDmgNumber(px, py, pz, amt, '#ffd966');
  }
  spawnParticles(p.position.x, 0.6, p.position.z, p.userData.mesh.material.color.getHex(), 10, 1.5, false);
}

/* ─── PROJECTILES (arrows) ───────────────────────────────────── */

export function spawnArrow(fromX, fromZ, dx, dz, damage) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc09060, emissive: 0x553311, emissiveIntensity: 0.4,
  });
  const arrow = new THREE.Mesh(geo, mat);
  arrow.castShadow = true;
  g.add(arrow);
  g.position.set(fromX, 0.8, fromZ);
  g.lookAt(fromX + dx, 0.8, fromZ + dz);
  g.userData = { dx, dz, life: 2.5, damage };
  state.scene.add(g);
  state.projectiles.push(g);
}

export function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.userData.life -= dt;
    const speed = 12;
    p.position.x += p.userData.dx * speed * dt;
    p.position.z += p.userData.dz * speed * dt;

    const dx = p.position.x - state.player.position.x;
    const dz = p.position.z - state.player.position.z;
    if (Math.hypot(dx, dz) < 0.7) {
      damagePlayer(p.userData.damage);
      state.scene.remove(p);
      disposeNode(p);
      state.projectiles.splice(i, 1);
      continue;
    }

    if (isWallAt(p.position.x, p.position.z) || p.userData.life <= 0) {
      spawnParticles(p.position.x, p.position.y, p.position.z, 0xc09060, 4, 1.0, false);
      state.scene.remove(p);
      disposeNode(p);
      state.projectiles.splice(i, 1);
    }
  }
}
