// Entry point. Wires everything together: boot, run lifecycle, game loop.

import './style.css';

import { state, saveBestFloor, saveClassKey } from './state.js';
import { seedRng } from './utils/rng.js';
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

// Wait for both the time-sliced theme placement and the time-sliced enemy
// spawn to finish before lifting the transitioning gate, then prewarm the
// renderer so the FIRST gameplay frame doesn't trigger a 200-700ms shader
// compile (which is what was driving the INP spikes Vercel was reporting).
function onFloorBuildReady() {
  let themesDone = false, enemiesDone = false;
  function maybeFinish() {
    if (!themesDone || !enemiesDone) return;
    // Force every material/shader on screen to compile NOW, not at first
    // render. Eats the cost during the loading pause instead of mid-game.
    state.renderer.compile(state.scene, state.camera);
    state.run.transitioning = false;
  }
  return {
    onThemes: () => { themesDone = true; maybeFinish(); },
    onEnemies: () => { enemiesDone = true; maybeFinish(); },
  };
}

function startRun() {
  resetRun();
  state.run.floor = 1;
  state.run.transitioning = true; // gate stairs/boons during initial async spawn
  generateDungeon(state.run.floor);
  const ready = onFloorBuildReady();
  buildDungeonMesh(ready.onThemes);
  spawnPlayer();
  spawnEnemiesForFloor(state.run.floor, ready.onEnemies);
  spawnPickupsForFloor(state.run.floor);
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
  // Snapshot menu prefs into the run so a save/replay plays the class &
  // difficulty it was recorded with, even if the menu pref changed since.
  state.run.classKey = state.pClassKey;
  state.run.difficultyKey = state.pDifficultyKey;
  // Fresh seed per run. Cap to a 32-bit unsigned for mulberry32. The seed
  // is also surfaced in the pause menu so bug reports / speedruns can
  // reference it.
  state.run.seed = (Date.now() & 0xffffffff) >>> 0;
  seedRng(state.run.seed);

  const cls = CLASSES[state.run.classKey] || CLASSES.warrior;
  const diff = DIFFICULTIES[state.run.difficultyKey] || DIFFICULTIES.medium;
  state.run.stats = {
    hp: cls.stats.hp, maxHp: cls.stats.hp,
    // Difficulty multiplies the player's base attack so easy mode actually
    // feels easier (also speeds up clears).
    atk: Math.round(cls.stats.atk * diff.playerAtkMul),
    spd: cls.stats.spd,
    gold: 0, kills: 0,
    // Boon multipliers / additions (1 = no change). Reset per run.
    atkCdMul: 1, dashCdMul: 1, atkRangeAdd: 0, atkArcMul: 1,
  };
  state.run.boons = [];
  state.run.pendingBoon = false;
  state.run.floor = 1;
}

function nextFloor() {
  clearEntities();

  generateDungeon(state.run.floor);

  const r = state.rooms[0];
  state.player.position.set(r.cx * CELL, 0, r.cz * CELL);

  // Both buildDungeonMesh (theme placement) and spawnEnemiesForFloor are
  // time-sliced across frames. The transitioning gate stays raised until
  // both signal done, then renderer.compile() prewarms shaders so the first
  // frame back in gameplay doesn't stall.
  const ready = onFloorBuildReady();
  buildDungeonMesh(ready.onThemes);
  spawnEnemiesForFloor(state.run.floor, ready.onEnemies);
  spawnPickupsForFloor(state.run.floor);

  // Small heal between floors
  state.run.stats.hp = Math.min(state.run.stats.maxHp, state.run.stats.hp + 15);
  if (state.run.floor > state.bestFloor) {
    state.bestFloor = state.run.floor;
    saveBestFloor(state.bestFloor);
  }
  updateHud();
}

function checkStairs() {
  if (!state.stairsPos || state.run.pendingBoon || state.run.transitioning) return;
  const dx = state.player.position.x - state.stairsPos.x;
  const dz = state.player.position.z - state.stairsPos.z;
  if (Math.hypot(dx, dz) < 0.8 && state.enemies.length === 0) {
    SFX.stairs();
    state.run.floor++;
    if (state.run.floor > MAX_FLOOR) {
      // Should be caught by boss death first; safety net
      return;
    }
    // Defer the floor rebuild by one frame so we don't spend ~150ms
    // synchronously inside the game loop. The transition flag prevents
    // re-entry and the loop renders one neutral frame in between.
    state.run.transitioning = true;
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
    && state.run.floor < MAX_FLOOR
    && !state.run.pendingBoon
    && !state.run.transitioning;

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

  // Pre-build a "menu scene" so something atmospheric renders behind the menu.
  // Seed once here so the menu dungeon varies across page reloads instead of
  // looking identical every time.
  seedRng((Date.now() & 0xffffffff) >>> 0);
  generateDungeon(1);
  // Compile shaders eagerly once theme placement finishes — same trick as
  // floor transitions, applied to the menu scene so the first click into
  // a real run doesn't pay the compile bill twice.
  buildDungeonMesh(() => state.renderer.compile(state.scene, state.camera));
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
