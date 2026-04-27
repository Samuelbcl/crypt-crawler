// The player avatar: 3D model, movement, dash, sword attack with arc check.

import * as THREE from 'three';
import { state } from './state.js';
import {
  ATTACK_RANGE, ATTACK_ARC, ATTACK_COOLDOWN, ATTACK_DURATION,
  DASH_DISTANCE, DASH_DURATION, DASH_COOLDOWN,
} from './constants.js';
import { moveWithCollide } from './dungeon.js';
import { getMouseGroundTarget } from './input.js';
import { SFX } from './audio.js';
import { spawnParticles } from './particles.js';
import { damageEnemy } from './combat.js';

export function buildPlayer() {
  const g = new THREE.Group();

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.9, 12);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4488dd, roughness: 0.5, metalness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  g.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.3, 16, 12);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfdc998, roughness: 0.7 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.15;
  head.castShadow = true;
  g.add(head);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111122 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.1, 1.18, 0.25);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.1, 1.18, 0.25);
  g.add(eyeL); g.add(eyeR);

  // Sword (animated during attack)
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.35, 0.7, 0.1);

  const bladeGeo = new THREE.BoxGeometry(0.08, 0.9, 0.04);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xddddee, roughness: 0.3, metalness: 0.8,
    emissive: 0x222244, emissiveIntensity: 0.3,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = 0.45;
  blade.castShadow = true;
  swordPivot.add(blade);

  const guardMat = new THREE.MeshStandardMaterial({ color: 0xc0a060, metalness: 0.7 });
  swordPivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.1), guardMat));

  const hiltMat = new THREE.MeshStandardMaterial({ color: 0x4a2d18 });
  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), hiltMat);
  hilt.position.y = -0.12;
  swordPivot.add(hilt);

  swordPivot.rotation.z = -0.2; // resting position
  g.add(swordPivot);
  g.userData.sword = swordPivot;

  // Hero glow
  const pl = new THREE.PointLight(0x88aaff, 0.8, 6);
  pl.position.y = 1.5;
  g.add(pl);
  g.userData.light = pl;

  return g;
}

export function spawnPlayer() {
  if (state.player) state.scene.remove(state.player);
  state.player = buildPlayer();
  const r = state.rooms[0];
  state.player.position.set(r.cx * 2, 0, r.cz * 2);
  state.scene.add(state.player);

  state.pAttack = { active: false, t: 0, cd: 0 };
  state.pDash = { active: false, t: 0, cd: 0, dirX: 0, dirZ: 0 };
  state.pInvuln = 0;
}

export function updatePlayer(dt) {
  if (!state.player) return;

  state.pAttack.cd = Math.max(0, state.pAttack.cd - dt);
  state.pDash.cd = Math.max(0, state.pDash.cd - dt);
  state.pInvuln = Math.max(0, state.pInvuln - dt);

  // Aim toward mouse on ground plane
  const target = getMouseGroundTarget();
  let aimX = 0, aimZ = -1;
  if (target) {
    aimX = target.x - state.player.position.x;
    aimZ = target.z - state.player.position.z;
    const len = Math.hypot(aimX, aimZ);
    if (len > 0.01) { aimX /= len; aimZ /= len; }
    state.player.rotation.y = Math.atan2(aimX, aimZ);
  }

  // Movement input (QWERTY/AZERTY/arrows)
  let mx = 0, mz = 0;
  if (state.keys['w'] || state.keys['z'] || state.keys['arrowup']) mz -= 1;
  if (state.keys['s'] || state.keys['arrowdown']) mz += 1;
  if (state.keys['a'] || state.keys['q'] || state.keys['arrowleft']) mx -= 1;
  if (state.keys['d'] || state.keys['arrowright']) mx += 1;
  const mlen = Math.hypot(mx, mz);
  if (mlen > 0) { mx /= mlen; mz /= mlen; }

  if (state.pDash.active) {
    state.pDash.t -= dt;
    const dashSpeed = DASH_DISTANCE / DASH_DURATION;
    moveWithCollide(state.player, state.pDash.dirX * dashSpeed * dt, state.pDash.dirZ * dashSpeed * dt, 0.35);
    if (state.pDash.t <= 0) state.pDash.active = false;
    state.pInvuln = Math.max(state.pInvuln, 0.05);
  } else if (mlen > 0) {
    const speed = 5.5 * state.pStats.spd;
    moveWithCollide(state.player, mx * speed * dt, mz * speed * dt, 0.35);
    // bob while moving
    state.player.position.y = Math.abs(Math.sin(performance.now() * 0.012)) * 0.05;
  } else {
    state.player.position.y = 0;
  }

  // Attack trigger
  if (state.mouseClickedThisFrame && state.pAttack.cd <= 0 && !state.pAttack.active) {
    state.pAttack.active = true;
    state.pAttack.t = ATTACK_DURATION;
    state.pAttack.cd = ATTACK_COOLDOWN;
    SFX.swing();
    doAttack(aimX, aimZ);
  }

  // Sword animation
  const sword = state.player.userData.sword;
  if (state.pAttack.active) {
    state.pAttack.t -= dt;
    if (state.pAttack.t <= 0) state.pAttack.active = false;
    const progress = 1 - (state.pAttack.t / ATTACK_DURATION);
    const swing = Math.sin(progress * Math.PI) * 1.8 - 0.9;
    sword.rotation.z = -0.2 + swing;
    sword.rotation.x = -progress * 0.6;
  } else {
    sword.rotation.z += (-0.2 - sword.rotation.z) * 0.2;
    sword.rotation.x += (0 - sword.rotation.x) * 0.2;
  }

  state.mouseClickedThisFrame = false;
}

export function tryDash() {
  if (state.pDash.cd > 0 || state.pDash.active) return;

  let mx = 0, mz = 0;
  if (state.keys['w'] || state.keys['z'] || state.keys['arrowup']) mz -= 1;
  if (state.keys['s'] || state.keys['arrowdown']) mz += 1;
  if (state.keys['a'] || state.keys['q'] || state.keys['arrowleft']) mx -= 1;
  if (state.keys['d'] || state.keys['arrowright']) mx += 1;
  const len = Math.hypot(mx, mz);

  if (len < 0.01) {
    // No movement key: dash toward aim
    const tgt = getMouseGroundTarget();
    if (!tgt) return;
    mx = tgt.x - state.player.position.x;
    mz = tgt.z - state.player.position.z;
    const l2 = Math.hypot(mx, mz);
    if (l2 < 0.01) return;
    mx /= l2; mz /= l2;
  } else {
    mx /= len; mz /= len;
  }

  state.pDash.active = true;
  state.pDash.t = DASH_DURATION;
  state.pDash.cd = DASH_COOLDOWN;
  state.pDash.dirX = mx;
  state.pDash.dirZ = mz;
  state.pInvuln = DASH_DURATION;

  SFX.dash();
  spawnParticles(state.player.position.x, 0.3, state.player.position.z, 0x88aaff, 6, 1.5, false);
}

function doAttack(aimX, aimZ) {
  for (const e of state.enemies) {
    const dx = e.position.x - state.player.position.x;
    const dz = e.position.z - state.player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ATTACK_RANGE + e.userData.stats.radius) continue;
    if (dist < 0.01) continue;
    const ex = dx / dist, ez = dz / dist;
    const dot = ex * aimX + ez * aimZ;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle <= ATTACK_ARC * 0.5) {
      damageEnemy(e, state.pStats.atk);
    }
  }
  // Visual swing trail
  const swX = state.player.position.x + aimX * 1.5;
  const swZ = state.player.position.z + aimZ * 1.5;
  spawnParticles(swX, 1.0, swZ, 0xaaccff, 5, 1.2, false);
}
