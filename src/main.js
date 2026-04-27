// Entry point. Wires everything together: boot, run lifecycle, game loop.

import './style.css';

import { state } from './state.js';
import { STATE, CELL, MAX_FLOOR } from './constants.js';

import { initThree, updateCamera, updateTorches } from './scene.js';
import { setupInput } from './input.js';
import { audioInit, SFX } from './audio.js';

import {
  generateDungeon, buildDungeonMesh,
} from './dungeon.js';

import { buildPlayer, spawnPlayer, updatePlayer } from './player.js';
import { spawnEnemiesForFloor, updateEnemies } from './enemies.js';
import { spawnPickupsForFloor, updatePickups, updateProjectiles } from './pickups.js';
import { updateParticles } from './particles.js';
import { showMenu, showHud, updateHud } from './ui.js';

/* ─── Run lifecycle ──────────────────────────────────────────── */

function startRun() {
  resetRun();
  state.pFloor = 1;
  generateDungeon(state.pFloor);
  buildDungeonMesh();
  spawnPlayer();
  spawnEnemiesForFloor(state.pFloor);
  spawnPickupsForFloor(state.pFloor);
  state.gameState = STATE.PLAYING;
  showHud();
  updateHud();
  audioInit();
}

function resetRun() {
  if (state.dungeonGroup) {
    state.scene.remove(state.dungeonGroup);
    state.dungeonGroup = null;
  }
  for (const e of state.enemies) state.scene.remove(e);
  state.enemies.length = 0;
  for (const p of state.pickups) state.scene.remove(p);
  state.pickups.length = 0;
  for (const p of state.projectiles) state.scene.remove(p);
  state.projectiles.length = 0;
  for (const p of state.particles) {
    state.scene.remove(p);
    p.geometry.dispose();
    p.material.dispose();
  }
  state.particles.length = 0;
  if (state.player) {
    state.scene.remove(state.player);
    state.player = null;
  }
  state.pStats = { hp: 100, maxHp: 100, atk: 10, spd: 1.0, gold: 0, kills: 0 };
  state.pFloor = 1;
}

function nextFloor() {
  for (const p of state.pickups) state.scene.remove(p);
  state.pickups.length = 0;
  for (const p of state.projectiles) state.scene.remove(p);
  state.projectiles.length = 0;
  for (const e of state.enemies) state.scene.remove(e);
  state.enemies.length = 0;

  generateDungeon(state.pFloor);
  buildDungeonMesh();

  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);

  spawnEnemiesForFloor(state.pFloor);
  spawnPickupsForFloor(state.pFloor);

  // Small heal between floors
  state.pStats.hp = Math.min(state.pStats.maxHp, state.pStats.hp + 15);
  if (state.pFloor > state.bestFloor) state.bestFloor = state.pFloor;
  updateHud();
}

function checkStairs() {
  if (!state.stairsPos) return;
  const dx = state.player.position.x - state.stairsPos.x;
  const dz = state.player.position.z - state.stairsPos.z;
  if (Math.hypot(dx, dz) < 0.8 && state.enemies.length === 0) {
    SFX.stairs();
    state.pFloor++;
    if (state.pFloor > MAX_FLOOR) {
      // Should be caught by boss death first; safety net
      return;
    }
    nextFloor();
  }
}

/* ─── Main loop ──────────────────────────────────────────────── */

function loop(now) {
  requestAnimationFrame(loop);
  const t = now * 0.001;
  let dt = t - state.lastTime;
  if (dt > 0.1) dt = 0.1; // clamp tab-switch lag
  state.lastTime = t;

  if (state.gameState === STATE.PLAYING) {
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateTorches(dt);
    checkStairs();
    updateHud();
  }

  // Always-on systems
  updateParticles(dt);
  if (state.player) updateCamera(dt);

  state.renderer.render(state.scene, state.camera);
}

/* ─── Boot ───────────────────────────────────────────────────── */

function boot() {
  initThree();
  setupInput();

  // Pre-build a "menu scene" so something atmospheric renders behind the menu
  generateDungeon(1);
  buildDungeonMesh();
  state.player = buildPlayer();
  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);
  state.scene.add(state.player);
  spawnEnemiesForFloor(1);
  spawnPickupsForFloor(1);

  document.getElementById('btn-play').addEventListener('click', () => {
    audioInit();
    startRun();
  });
  document.getElementById('btn-retry').addEventListener('click', () => startRun());
  document.getElementById('btn-victory').addEventListener('click', () => startRun());

  showMenu();
  state.lastTime = performance.now() * 0.001;
  requestAnimationFrame(loop);
}

boot();
