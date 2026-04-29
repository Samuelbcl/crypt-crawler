// Seeded pseudo-random generator for run-deterministic logic. Backs onto
// state.run.rngState so the entire RNG stream is captured by the run snapshot
// (save/load/replays/daily challenges all need this).
//
// Use rng() in place of Math.random() in any code path that influences
// gameplay (dungeon generation, enemy spawn rolls, loot tables, boon picks).
// Keep Math.random() for purely cosmetic noise (camera shake, particle
// scatter, torch flicker phase) — seeding those would just stiffen the look.
//
// mulberry32 is a 32-bit hash-based PRNG: tiny, fast, statistically fine for
// game logic. It's not cryptographic and that's fine.

import { state } from '../state.js';

export function seedRng(seed) {
  state.run.seed = seed >>> 0;
  state.run.rngState = state.run.seed;
}

// One step of mulberry32 using state.run.rngState as the live counter, so
// every call advances the serialized run state. No closures = trivially
// resumable from a deserialized snapshot.
export function rng() {
  state.run.rngState = (state.run.rngState + 0x6D2B79F5) | 0;
  let t = state.run.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Convenience: integer in [0, max).
export function rngInt(max) {
  return Math.floor(rng() * max);
}

// Convenience: pick one element of an array (deterministic).
export function rngPick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}
