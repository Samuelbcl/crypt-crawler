// Single mutable game state object, imported and mutated by other modules.
// Pragmatic approach for a small game; avoids passing huge contexts around.

import * as THREE from 'three';
import { STATE } from './constants.js';

export const state = {
  // ── Game flow ────────────────────────────
  gameState: STATE.MENU,
  pFloor: 1,
  bestFloor: 0,
  totalKills: 0,
  totalGold: 0,

  // ── World ────────────────────────────────
  dungeon: [],            // 2D array of cell types
  rooms: [],              // [{x,z,w,h,cx,cz}]
  stairsPos: null,        // {x, z} world coords
  stairsMesh: null,       // THREE.Group
  dungeonGroup: null,     // wraps everything for cleanup

  // ── Player ───────────────────────────────
  player: null,           // THREE.Group (with userData.sword, userData.light)
  pStats: null,           // {hp, maxHp, atk, spd, gold, kills}
  pAttack: { active: false, t: 0, cd: 0 },
  pDash:   { active: false, t: 0, cd: 0, dirX: 0, dirZ: 0 },
  pInvuln: 0,

  // ── Entities ─────────────────────────────
  enemies: [],
  projectiles: [],
  pickups: [],
  particles: [],

  // ── FX ───────────────────────────────────
  shakeAmount: 0,
  shakeDecay: 0,

  // ── Three.js refs (set by scene.js) ──────
  renderer: null,
  scene: null,
  camera: null,
  raycaster: null,
  groundPlane: null,

  // ── Input ────────────────────────────────
  keys: {},
  mouseX: 0,
  mouseY: 0,
  mouseDownLeft: false,
  mouseClickedThisFrame: false,

  // ── Timing ───────────────────────────────
  lastTime: 0,
};

// Shared scratch vector for hot paths (avoid per-frame allocations).
export const _scratchV3 = new THREE.Vector3();
