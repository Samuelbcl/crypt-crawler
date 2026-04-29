// Single mutable game state object, imported and mutated by other modules.
// Pragmatic approach for a small game; avoids passing huge contexts around.
//
// Two zones inside `state`:
//   • state.run        — the only fully serializable surface. Holds the seed,
//                        RNG counter, floor, stats, boons, etc. This is what
//                        save/load/replays read and write.
//   • everything else  — Three.js refs, input, UI flags, ephemeral world
//                        objects. Reconstructible from run + assets at load.

import * as THREE from 'three';
import { STATE, CLASSES, DIFFICULTIES } from './constants.js';

const BEST_FLOOR_KEY = 'cryptCrawler.bestFloor';
const CLASS_KEY = 'cryptCrawler.class';
const DIFFICULTY_KEY = 'cryptCrawler.difficulty';

function loadClassKey() {
  try {
    const v = localStorage.getItem(CLASS_KEY);
    return (v && CLASSES[v]) ? v : 'warrior';
  } catch (_) { return 'warrior'; }
}

export function saveClassKey(key) {
  try { localStorage.setItem(CLASS_KEY, key); } catch (_) {}
}

function loadDifficultyKey() {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    return (v && DIFFICULTIES[v]) ? v : 'medium';
  } catch (_) { return 'medium'; }
}

export function saveDifficultyKey(key) {
  try { localStorage.setItem(DIFFICULTY_KEY, key); } catch (_) {}
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

// Factory for a fresh, empty run. Called by resetRun() in main.js.
export function createRun() {
  return {
    // RNG — seeded at run start; rngState advances on every rng() call.
    seed: 0,
    rngState: 0,
    // Progress
    floor: 1,
    // Snapshot of menu selections at run start (so a loaded save still
    // plays the class/difficulty the run was recorded with, even if the
    // menu preference has since changed).
    classKey: 'warrior',
    difficultyKey: 'medium',
    // Stats live here (was state.pStats)
    stats: null,
    // Boons taken this run (was state.activeBoons)
    boons: [],
    // Flow gates (were state.pendingBoon / state.pFloorTransitioning)
    pendingBoon: false,
    transitioning: false,
  };
}

// Round-trip helpers — anything that wants to persist a run goes through
// these. JSON.stringify-safe: state.run holds only primitives + arrays of
// primitives + plain objects. Throw if someone slipped a Three.js ref in.
export function serializeRun() {
  return JSON.stringify(state.run);
}

export function deserializeRun(json) {
  const r = JSON.parse(json);
  state.run = Object.assign(createRun(), r);
}

export const state = {
  // ── Game flow ────────────────────────────
  gameState: STATE.MENU,
  bestFloor: loadBestFloor(),
  totalKills: 0,
  totalGold: 0,

  // ── Menu / persistent preferences ────────
  pClassKey: loadClassKey(),
  pDifficultyKey: loadDifficultyKey(),

  // ── Run state (serializable) ─────────────
  run: createRun(),

  // ── World ────────────────────────────────
  dungeon: [],            // 2D array of cell types
  rooms: [],              // [{x,z,w,h,cx,cz}]
  stairsPos: null,        // {x, z} world coords
  stairsMesh: null,       // THREE.Group
  dungeonGroup: null,     // wraps everything for cleanup
  guidanceArrow: null,    // floating arrow that points at the stairs

  // ── Player ───────────────────────────────
  player: null,           // THREE.Group (with userData.sword, userData.light)
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
