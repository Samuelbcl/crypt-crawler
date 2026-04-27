// All DOM/UI updates: HUD, screens, floating damage numbers, pause toggle.

import { state, _scratchV3, saveBestFloor, saveClassKey } from './state.js';
import { STATE, MAX_FLOOR, CLASSES, BOONS } from './constants.js';
import { SFX, getMasterVolume } from './audio.js';

/* ─── HUD ────────────────────────────────────────────────────── */

export function updateHud() {
  const hpFill = document.getElementById('hp-fill');
  const hpText = document.getElementById('hp-text');
  const ratio = Math.max(0, state.pStats.hp / state.pStats.maxHp);
  hpFill.style.width = (ratio * 100) + '%';
  hpText.textContent = Math.max(0, Math.ceil(state.pStats.hp)) + '/' + state.pStats.maxHp;
  // Dynamic colour: green > 60%, yellow 30-60%, red < 30%.
  if (ratio > 0.6) hpFill.style.background = 'linear-gradient(180deg, #66ff88, #2fa84d)';
  else if (ratio > 0.3) hpFill.style.background = 'linear-gradient(180deg, #ffd966, #c4a03e)';
  else hpFill.style.background = 'linear-gradient(180deg, #ff5555, #c43e3e)';

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
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('boon-picker').classList.add('hidden');
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
    showPauseMenu();
  } else if (state.gameState === STATE.PAUSED) {
    state.gameState = STATE.PLAYING;
    document.getElementById('pause-menu').classList.add('hidden');
  }
}

function showPauseMenu() {
  document.getElementById('pm-floor').textContent =
    state.pFloor === MAX_FLOOR ? 'Boss' : state.pFloor;
  // Sync slider with current persisted volume.
  const pct = Math.round(getMasterVolume() * 100);
  const slider = document.getElementById('pm-volume');
  slider.value = pct;
  document.getElementById('pm-volume-val').textContent = pct + '%';
  document.getElementById('pause-menu').classList.remove('hidden');
}

export function hidePauseMenu() {
  document.getElementById('pause-menu').classList.add('hidden');
}

/* ─── VICTORY TRIGGER (called by combat.js) ──────────────────── */

export function triggerVictory() {
  if (state.gameState === STATE.VICTORY || state.gameState === STATE.GAME_OVER) return;
  if (state.pFloor > state.bestFloor) {
    state.bestFloor = state.pFloor;
    saveBestFloor(state.bestFloor);
  }
  state.gameState = STATE.VICTORY;
  SFX.win();
  showVictory();
}

/* ─── CLASS PICKER (main menu) ───────────────────────────────── */

export function setupClassPicker() {
  const picker = document.getElementById('class-picker');
  const cards = picker.querySelectorAll('.class-card');
  function syncSelection() {
    cards.forEach((c) => {
      c.classList.toggle('selected', c.dataset.class === state.pClassKey);
    });
  }
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const key = card.dataset.class;
      if (!CLASSES[key]) return;
      state.pClassKey = key;
      saveClassKey(key);
      syncSelection();
    });
  });
  syncSelection();
}

/* ─── BOON PICKER (between floors) ───────────────────────────── */

let _onBoonPicked = null;

export function showBoonPicker(onPicked) {
  _onBoonPicked = onPicked;
  const row = document.getElementById('boon-row');
  row.innerHTML = '';

  // Pick 3 random boons that haven't already been taken this run.
  const pool = BOONS.filter((b) => !state.activeBoons.includes(b.id));
  // Even if everything's been picked once, fall back to the full list so the
  // overlay never shows zero choices on long runs.
  const choices = (pool.length >= 3 ? pool : BOONS.slice());
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  const picked = choices.slice(0, 3);

  for (const b of picked) {
    const card = document.createElement('button');
    card.className = 'boon-card';
    card.innerHTML = `
      <div class="boon-icon">${b.icon}</div>
      <div class="boon-label">${b.label}</div>
      <div class="boon-desc">${b.desc}</div>
    `;
    card.addEventListener('click', () => {
      b.apply(state.pStats);
      state.activeBoons.push(b.id);
      state.pendingBoon = false;
      document.getElementById('boon-picker').classList.add('hidden');
      updateHud();
      const cb = _onBoonPicked;
      _onBoonPicked = null;
      if (cb) cb();
    });
    row.appendChild(card);
  }
  document.getElementById('boon-picker').classList.remove('hidden');
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
