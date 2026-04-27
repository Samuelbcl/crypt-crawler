// Single mutable game state object, imported and mutated by other modules.
// Pragmatic approach for a small game; avoids passing huge contexts around.

import * as THREE from 'three';
import { STATE, CLASSES } from './constants.js';

const BEST_FLOOR_KEY = 'cryptCrawler.bestFloor';
const CLASS_KEY = 'cryptCrawler.class';

function loadClassKey() {
  try {
    const v = localStorage.getItem(CLASS_KEY);
    return (v && CLASSES[v]) ? v : 'warrior';
  } catch (_) { return 'warrior'; }
}

export function saveClassKey(key) {
  try { localStorage.setItem(CLASS_KEY, key); } catch (_) {}
}

function loadBestFloor() {
  try {
    const v = parseInt(localStorage.getItem(BEST_FLOOR_KEY) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (_) {
    return 0;
  }
}

export function saveBestFloor(floor) {
  try { localStorage.setItem(BEST_FLOOR_KEY, String(floor)); } catch (_) {}
}

export const state = {
  // ── Game flow ────────────────────────────
  gameState: STATE.MENU,
  pFloor: 1,
  bestFloor: loadBestFloor(),
  totalKills: 0,
  totalGold: 0,

  // ── Class & boons ────────────────────────
  pClassKey: loadClassKey(),     // current class (also persisted to localStorage)
  activeBoons: [],               // ids of boons already picked this run
  pendingBoon: false,            // true when a boon overlay must be resolved before stairs work

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
  hitstopT: 0,            // when > 0, the game loop freezes updates (renders only)

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
