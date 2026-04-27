// Entry point. Wires everything together: boot, run lifecycle, game loop.

import './style.css';

import { state, saveBestFloor, saveClassKey } from './state.js';
import { STATE, CELL, MAX_FLOOR, CLASSES, DIFFICULTIES } from './constants.js';

import { initThree, updateCamera, updateTorches, disposeNode, createGuidanceArrow } from './scene.js';
import { setupInput } from './input.js';
import { audioInit, SFX, setMasterVolume } from './audio.js';
import { preloadModels, preloadDungeon, updateMixers, releaseMixer } from './assets.js';

import {
  generateDungeon, buildDungeonMesh,
} from './dungeon.js';

import { buildPlayer, spawnPlayer, updatePlayer } from './player.js';
import { spawnEnemiesForFloor, updateEnemies, pendingEnemyCount } from './enemies.js';
import { spawnPickupsForFloor, updatePickups, updateProjectiles } from './pickups.js';
import { updateParticles, clearParticles } from './particles.js';
import { showMenu, showHud, updateHud, togglePause, hidePauseMenu, setupClassPicker, setupDifficultyPicker } from './ui.js';

/* ─── Run lifecycle ──────────────────────────────────────────── */

function startRun() {
  resetRun();
  state.pFloor = 1;
  state.pFloorTransitioning = true; // gate stairs/boons during initial async spawn
  generateDungeon(state.pFloor);
  buildDungeonMesh();
  spawnPlayer();
  spawnEnemiesForFloor(state.pFloor, () => {
    state.pFloorTransitioning = false;
  });
  spawnPickupsForFloor(state.pFloor);
  state.gameState = STATE.PLAYING;
  showHud();
  updateHud();
  audioInit();
}

function clearEntities() {
  for (const e of state.enemies) {
    state.scene.remove(e);
    if (e.userData.mixer) releaseMixer(e.userData.mixer);
    disposeNode(e);
  }
  state.enemies.length = 0;
  for (const p of state.pickups) { state.scene.remove(p); disposeNode(p); }
  state.pickups.length = 0;
  for (const p of state.projectiles) { state.scene.remove(p); disposeNode(p); }
  state.projectiles.length = 0;
}

function resetRun() {
  if (state.dungeonGroup) {
    state.scene.remove(state.dungeonGroup);
    state.dungeonGroup = null;
  }
  clearEntities();
  clearParticles();
  if (state.player) {
    state.scene.remove(state.player);
    if (state.player.userData.mixer) releaseMixer(state.player.userData.mixer);
    disposeNode(state.player);
    state.player = null;
  }
  const cls = CLASSES[state.pClassKey] || CLASSES.warrior;
  const diff = DIFFICULTIES[state.pDifficultyKey] || DIFFICULTIES.medium;
  state.pStats = {
    hp: cls.stats.hp, maxHp: cls.stats.hp,
    // Difficulty multiplies the player's base attack so easy mode actually
    // feels easier (also speeds up clears).
    atk: Math.round(cls.stats.atk * diff.playerAtkMul),
    spd: cls.stats.spd,
    gold: 0, kills: 0,
    // Boon multipliers / additions (1 = no change). Reset per run.
    atkCdMul: 1, dashCdMul: 1, atkRangeAdd: 0, atkArcMul: 1,
  };
  state.activeBoons = [];
  state.pendingBoon = false;
  state.pFloor = 1;
}

function nextFloor() {
  clearEntities();

  generateDungeon(state.pFloor);
  buildDungeonMesh();

  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);

  // Enemies spawn time-sliced across frames; the transition flag stays
  // raised until the queue drains so stairs / boon checks don't fire on
  // a half-populated floor.
  spawnEnemiesForFloor(state.pFloor, () => {
    state.pFloorTransitioning = false;
  });
  spawnPickupsForFloor(state.pFloor);

  // Small heal between floors
  state.pStats.hp = Math.min(state.pStats.maxHp, state.pStats.hp + 15);
  if (state.pFloor > state.bestFloor) {
    state.bestFloor = state.pFloor;
    saveBestFloor(state.bestFloor);
  }
  updateHud();
}

function checkStairs() {
  if (!state.stairsPos || state.pendingBoon || state.pFloorTransitioning) return;
  const dx = state.player.position.x - state.stairsPos.x;
  const dz = state.player.position.z - state.stairsPos.z;
  if (Math.hypot(dx, dz) < 0.8 && state.enemies.length === 0) {
    SFX.stairs();
    state.pFloor++;
    if (state.pFloor > MAX_FLOOR) {
      // Should be caught by boss death first; safety net
      return;
    }
    // Defer the floor rebuild by one frame so we don't spend ~150ms
    // synchronously inside the game loop. The transition flag prevents
    // re-entry and the loop renders one neutral frame in between.
    state.pFloorTransitioning = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // nextFloor() kicks off the time-sliced enemy spawn; the flag is
        // cleared in its onComplete callback once every enemy is alive.
        nextFloor();
      });
    });
  }
}

/* ─── Guidance arrow ─────────────────────────────────────────── */

// Floats just in front of the player, points at the stairs, bobs and
// pulses. Only shown after the floor is cleared so the visual doesn't
// distract during combat — and never on the boss floor where the goal
// is the boss, not the stairs.
function updateGuidanceArrow(t) {
  const arrow = state.guidanceArrow;
  if (!arrow) return;

  const visible = state.player
    && state.stairsPos
    && state.enemies.length === 0
    && state.pFloor < MAX_FLOOR
    && !state.pendingBoon
    && !state.pFloorTransitioning;

  arrow.visible = visible;
  if (!visible) return;

  const px = state.player.position.x;
  const pz = state.player.position.z;
  const dx = state.stairsPos.x - px;
  const dz = state.stairsPos.z - pz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;

  // Hover ~1.4 m ahead of the player toward the stairs, chest height,
  // with a gentle bob and pulse.
  const dist = 1.4;
  arrow.position.set(
    px + ux * dist,
    1.4 + Math.sin(t * 4) * 0.12,
    pz + uz * dist,
  );
  arrow.rotation.y = Math.atan2(ux, uz);
  arrow.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
}

/* ─── Main loop ──────────────────────────────────────────────── */

function loop(now) {
  requestAnimationFrame(loop);
  const t = now * 0.001;
  let dt = t - state.lastTime;
  if (dt > 0.1) dt = 0.1; // clamp tab-switch lag
  state.lastTime = t;

  // Hitstop: freeze gameplay updates briefly to add weight to a strike.
  // Camera shake still bleeds in via the render call below for that "punch".
  if (state.hitstopT > 0) {
    state.hitstopT -= dt;
    state.renderer.render(state.scene, state.camera);
    return;
  }

  if (state.gameState === STATE.PLAYING) {
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateTorches(dt);
    updateGuidanceArrow(t);
    checkStairs();
    updateHud();
  } else if (state.guidanceArrow) {
    state.guidanceArrow.visible = false;
  }

  // Always-on systems. Animations only run during gameplay — menu and
  // pause freeze them so the menu doesn't burn 6+ mixer updates per frame.
  updateParticles(dt);
  if (state.gameState === STATE.PLAYING) updateMixers(dt);
  if (state.player) updateCamera(dt);

  state.renderer.render(state.scene, state.camera);
}

/* ─── Boot ───────────────────────────────────────────────────── */

async function boot() {
  initThree();
  setupInput();

  const playBtn = document.getElementById('btn-play');
  const playLabel = playBtn.textContent;
  playBtn.textContent = '⏳ CHARGEMENT…';
  playBtn.disabled = true;

  // Block on every model preload (characters + dungeon modules) so the
  // first dungeon build doesn't hit a missing-cache error.
  await Promise.all([preloadModels(), preloadDungeon()]);

  playBtn.textContent = playLabel;
  playBtn.disabled = false;

  setupClassPicker();
  setupDifficultyPicker();

  // Guidance arrow lives across runs — added once, toggled visibility.
  state.guidanceArrow = createGuidanceArrow();
  state.scene.add(state.guidanceArrow);

  // Pre-build a "menu scene" so something atmospheric renders behind the menu
  generateDungeon(1);
  buildDungeonMesh();
  state.player = buildPlayer();
  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);
  state.scene.add(state.player);
  spawnEnemiesForFloor(1);
  spawnPickupsForFloor(1);

  // Defer the heavy run-creation work (model clones, mixer setup, mesh
  // builds) to a fresh frame so the click handler returns fast and the
  // browser can repaint the loading state — keeps interaction timings low.
  function deferredStartRun() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => startRun());
    });
  }

  document.getElementById('btn-play').addEventListener('click', () => {
    audioInit();
    deferredStartRun();
  });
  document.getElementById('btn-retry').addEventListener('click', deferredStartRun);
  document.getElementById('btn-victory').addEventListener('click', deferredStartRun);

  // Pause menu wiring
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-restart').addEventListener('click', () => {
    hidePauseMenu();
    deferredStartRun();
  });
  document.getElementById('btn-quit-menu').addEventListener('click', () => {
    hidePauseMenu();
    resetRun();
    state.gameState = STATE.MENU;
    showMenu();
  });
  const volSlider = document.getElementById('pm-volume');
  const volLabel = document.getElementById('pm-volume-val');
  volSlider.addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    setMasterVolume(pct / 100);
    volLabel.textContent = pct + '%';
  });

  showMenu();
  state.lastTime = performance.now() * 0.001;
  requestAnimationFrame(loop);
}

boot();
