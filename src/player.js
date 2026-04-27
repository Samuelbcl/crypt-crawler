// The player avatar: Quaternius Warrior model with animations,
// movement, dash, sword attack with arc check.

import * as THREE from 'three';
import { state } from './state.js';
import {
  ATTACK_RANGE, ATTACK_ARC, ATTACK_COOLDOWN, ATTACK_DURATION,
  DASH_DISTANCE, DASH_DURATION, DASH_COOLDOWN, CELL,
} from './constants.js';
import { moveWithCollide } from './dungeon.js';
import { getMouseGroundTarget } from './input.js';
import { SFX } from './audio.js';
import { spawnParticles } from './particles.js';
import { damageEnemy } from './combat.js';
import { instantiate, playOnly } from './assets.js';

// Quaternius models already import facing +Z (same as the old primitive
// avatars), so no rotation offset is needed — Math.atan2(aimX, aimZ) on the
// parent already aligns the model with the aim direction.
const MODEL_FORWARD_OFFSET = 0;
const PLAYER_SCALE = 0.55;

// Body rotation speed in radians/second. ~12 means a 180° flip takes ~0.26s,
// snappy without feeling jittery on diagonal direction changes.
const TURN_SPEED = 12;

function shortestAngleDelta(from, to) {
  let d = (to - from + Math.PI) % (2 * Math.PI);
  if (d < 0) d += 2 * Math.PI;
  return d - Math.PI;
}

export function buildPlayer() {
  const g = new THREE.Group();

  const { root, mixer, actions } = instantiate('warrior');
  root.scale.setScalar(PLAYER_SCALE);
  root.rotation.y = MODEL_FORWARD_OFFSET;
  g.add(root);

  // Hero glow keeps the heroic vibe and helps in dark dungeons
  const pl = new THREE.PointLight(0x88aaff, 0.8, 6);
  pl.position.y = 1.5;
  g.add(pl);

  g.userData.modelRoot = root;
  g.userData.mixer = mixer;
  g.userData.actions = actions;
  g.userData.light = pl;
  g.userData.currentAnim = null;

  setAnim(g, 'Idle');
  return g;
}

function setAnim(playerGroup, name, opts) {
  if (playerGroup.userData.currentAnim === name) return;
  playerGroup.userData.currentAnim = name;
  playOnly(playerGroup.userData.actions, name, opts);
}

export function spawnPlayer() {
  if (state.player) state.scene.remove(state.player);
  state.player = buildPlayer();
  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);
  state.scene.add(state.player);

  state.pAttack = { active: false, t: 0, cd: 0 };
  state.pDash = { active: false, t: 0, cd: 0, dirX: 0, dirZ: 0 };
  state.pInvuln = 0;
  // Swallow any click that fired while opening the menu / pause overlay.
  state.mouseClickedThisFrame = false;
}

export function updatePlayer(dt) {
  if (!state.player) return;

  state.pAttack.cd = Math.max(0, state.pAttack.cd - dt);
  state.pDash.cd = Math.max(0, state.pDash.cd - dt);
  state.pInvuln = Math.max(0, state.pInvuln - dt);

  // Aim toward mouse on ground plane (used for attack direction always)
  const target = getMouseGroundTarget();
  let aimX = 0, aimZ = -1;
  if (target) {
    aimX = target.x - state.player.position.x;
    aimZ = target.z - state.player.position.z;
    const len = Math.hypot(aimX, aimZ);
    if (len > 0.01) { aimX /= len; aimZ /= len; }
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
  }
  state.player.position.y = 0;

  // Attack trigger
  if (state.mouseClickedThisFrame && state.pAttack.cd <= 0 && !state.pAttack.active) {
    state.pAttack.active = true;
    state.pAttack.t = ATTACK_DURATION;
    state.pAttack.cd = ATTACK_COOLDOWN;
    SFX.swing();
    doAttack(aimX, aimZ);
  }
  if (state.pAttack.active) {
    state.pAttack.t -= dt;
    if (state.pAttack.t <= 0) state.pAttack.active = false;
  }

  // Body rotation: face the mouse during an attack swing (so the slash points
  // at the cursor), otherwise face the movement direction. Standing still
  // keeps the last facing — no auto-snap to mouse, which felt twitchy.
  let targetYaw = null;
  if (state.pAttack.active) {
    targetYaw = Math.atan2(aimX, aimZ);
  } else if (mlen > 0) {
    targetYaw = Math.atan2(mx, mz);
  }
  if (targetYaw !== null) {
    const delta = shortestAngleDelta(state.player.rotation.y, targetYaw);
    state.player.rotation.y += delta * Math.min(1, dt * TURN_SPEED);
  }

  // Animation selection — priority: dash > attack > run > idle.
  // Death is set externally in combat.js.
  if (state.pDash.active) {
    setAnim(state.player, 'Roll', { loop: false, crossfade: 0.05 });
  } else if (state.pAttack.active) {
    setAnim(state.player, 'Sword_Attack', { loop: false, crossfade: 0.05 });
  } else if (mlen > 0) {
    setAnim(state.player, 'Run_Weapon');
  } else {
    setAnim(state.player, 'Idle_Weapon');
  }

  state.mouseClickedThisFrame = false;
}

export function playPlayerDeath() {
  if (!state.player) return;
  setAnim(state.player, 'Death', { loop: false, crossfade: 0.1 });
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
