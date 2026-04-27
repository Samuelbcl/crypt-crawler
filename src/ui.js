// All DOM/UI updates: HUD, screens, floating damage numbers, pause toggle.

import { state, _scratchV3 } from './state.js';
import { STATE, MAX_FLOOR } from './constants.js';
import { SFX } from './audio.js';

/* ─── HUD ────────────────────────────────────────────────────── */

export function updateHud() {
  const hpFill = document.getElementById('hp-fill');
  const hpText = document.getElementById('hp-text');
  const ratio = Math.max(0, state.pStats.hp / state.pStats.maxHp);
  hpFill.style.width = (ratio * 100) + '%';
  hpText.textContent = Math.max(0, Math.ceil(state.pStats.hp)) + '/' + state.pStats.maxHp;

  document.getElementById('floor-num').textContent =
    state.pFloor === MAX_FLOOR ? '⚠ ÉTAGE BOSS' : 'Étage ' + state.pFloor;

  const enemyCount = state.enemies.length;
  document.getElementById('enemies-left').textContent =
    enemyCount + ' ennemi' + (enemyCount > 1 ? 's' : '');

  document.getElementById('stat-atk').textContent = state.pStats.atk;
  document.getElementById('stat-spd').textContent = state.pStats.spd.toFixed(1);
  document.getElementById('stat-gold').textContent = state.pStats.gold;

  const hint = document.getElementById('hint');
  if (enemyCount === 0 && state.stairsPos) hint.classList.remove('hidden');
  else hint.classList.add('hidden');
}

/* ─── SCREENS ────────────────────────────────────────────────── */

export function showMenu() {
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  document.getElementById('crosshair').style.display = 'none';
  const best = document.getElementById('menu-best');
  if (state.bestFloor > 0) {
    best.textContent = 'Meilleur run cette session : étage ' + state.bestFloor;
  }
}

export function showHud() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  document.getElementById('crosshair').style.display = 'block';
}

export function showGameOver() {
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover').classList.remove('hidden');
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('go-floor').textContent = state.pFloor;
  document.getElementById('go-gold').textContent = state.pStats.gold;
  document.getElementById('go-kills').textContent = state.pStats.kills;
  document.getElementById('go-best').textContent = 'Record : étage ' + state.bestFloor;
}

export function showVictory() {
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('victory').classList.remove('hidden');
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('vw-gold').textContent = state.pStats.gold;
  document.getElementById('vw-kills').textContent = state.pStats.kills;
}

/* ─── PAUSE ──────────────────────────────────────────────────── */

export function togglePause() {
  if (state.gameState === STATE.PLAYING) {
    state.gameState = STATE.PAUSED;
    document.getElementById('pause-hint').classList.remove('hidden');
  } else if (state.gameState === STATE.PAUSED) {
    state.gameState = STATE.PLAYING;
    document.getElementById('pause-hint').classList.add('hidden');
  }
}

/* ─── VICTORY TRIGGER (called by combat.js) ──────────────────── */

export function triggerVictory() {
  if (state.gameState === STATE.VICTORY || state.gameState === STATE.GAME_OVER) return;
  if (state.pFloor > state.bestFloor) state.bestFloor = state.pFloor;
  state.gameState = STATE.VICTORY;
  SFX.win();
  showVictory();
}

/* ─── FLOATING DAMAGE NUMBERS ────────────────────────────────── */

export function showDmgNumber(wx, wy, wz, val, color) {
  const proj = _scratchV3.set(wx, wy, wz).project(state.camera);
  const sx = (proj.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
  const div = document.createElement('div');
  div.className = 'dmg-number';
  div.textContent = '-' + val;
  div.style.color = color;
  div.style.left = sx + 'px';
  div.style.top = sy + 'px';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 950);
}
