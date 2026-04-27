// Cross-cutting combat logic. Lives in its own module so player.js,
// enemies.js and pickups.js (projectiles) can all call into it without
// circular dependencies.

import * as THREE from 'three';
import { state, saveBestFloor } from './state.js';
import { STATE, MAX_FLOOR } from './constants.js';
import { spawnParticles } from './particles.js';
import { showDmgNumber, showGameOver, triggerVictory, showBoonPicker } from './ui.js';
import { SFX } from './audio.js';
import { shake, disposeNode } from './scene.js';
import { moveWithCollide } from './dungeon.js';
import { makePickup } from './pickups.js';
import { playPlayerDeath } from './player.js';
import { releaseMixer } from './assets.js';

export function damageEnemy(e, dmg) {
  const s = e.userData.stats;
  s.hp -= dmg;
  e.userData.hurtT = 0.15;

  showDmgNumber(e.position.x, e.position.y + 1.8, e.position.z, dmg, '#ffaa44');
  spawnParticles(e.position.x, 1.0, e.position.z, s.color, 6, 1.5);
  shake(0.12, 0.4);
  // Very brief hitstop — adds a tiny bit of weight without reading as a
  // stutter. Boss hits get a slightly longer beat for impact pacing.
  state.hitstopT = Math.max(state.hitstopT, s.isBoss ? 0.05 : 0.025);
  SFX.hit();

  // Knockback away from player
  const dx = e.position.x - state.player.position.x;
  const dz = e.position.z - state.player.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.01) {
    const kbx = (dx / dist) * 0.4;
    const kbz = (dz / dist) * 0.4;
    moveWithCollide(e, kbx, kbz, s.radius);
  }

  if (s.hp <= 0) {
    onEnemyDeath(e);
  }
}

export function onEnemyDeath(e) {
  const s = e.userData.stats;
  spawnParticles(e.position.x, 1.0, e.position.z, s.color, 18, 3.0);
  spawnParticles(e.position.x, 0.5, e.position.z, 0xffffff, 6, 2.0, false);
  shake(0.2, 0.5);
  SFX.enemyDie();

  // Drop gold sometimes (not for boss — boss has its own win flow)
  if (Math.random() < 0.55 && !s.isBoss) {
    const p = makePickup('gold', e.position.x, e.position.z);
    state.pickups.push(p);
    state.scene.add(p);
  }

  state.scene.remove(e);
  if (e.userData.mixer) releaseMixer(e.userData.mixer);
  disposeNode(e);
  state.pStats.kills++;
  state.totalKills++;

  const idx = state.enemies.indexOf(e);
  if (idx >= 0) state.enemies.splice(idx, 1);

  if (s.isBoss && state.gameState === STATE.PLAYING) {
    setTimeout(triggerVictory, 800);
  }

  // Floor cleared on a non-boss floor → offer a boon before the stairs unlock.
  if (!s.isBoss
      && state.enemies.length === 0
      && state.gameState === STATE.PLAYING
      && state.pFloor < MAX_FLOOR
      && !state.pendingBoon) {
    state.pendingBoon = true;
    setTimeout(() => showBoonPicker(), 600);
  }
}

export function damagePlayer(amount) {
  if (state.pInvuln > 0) return;

  state.pStats.hp -= amount;
  state.pInvuln = 0.6;

  showDmgNumber(
    state.player.position.x,
    state.player.position.y + 1.8,
    state.player.position.z,
    amount, '#ff5555',
  );
  spawnParticles(state.player.position.x, 1.0, state.player.position.z, 0xff5555, 8, 2.0);
  // Lighter, faster-decaying shake — was 0.25/0.6, felt disorienting when
  // combined with the smooth body rotation lerp.
  shake(0.15, 0.9);
  flashScreen('hit');
  SFX.hurt();

  if (state.pStats.hp <= 0) {
    state.pStats.hp = 0;
    onPlayerDeath();
  }
}

export function onPlayerDeath() {
  if (state.pFloor > state.bestFloor) {
    state.bestFloor = state.pFloor;
    saveBestFloor(state.bestFloor);
  }
  state.gameState = STATE.GAME_OVER;
  SFX.death();
  shake(0.4, 0.5);
  spawnParticles(
    state.player.position.x, 1.0, state.player.position.z,
    0xff4444, 30, 4.0,
  );
  playPlayerDeath();
  setTimeout(showGameOver, 700);
}

export function flashScreen(cls) {
  const f = document.getElementById('flash');
  f.classList.add(cls);
  setTimeout(() => f.classList.remove(cls), 100);
}
