// Keyboard + mouse handling. The mouse-to-ground raycast is exposed as
// getMouseGroundTarget() because both player aim and dash direction need it.

import * as THREE from 'three';
import { state } from './state.js';
import { STATE } from './constants.js';
import { audioInit } from './audio.js';
import { tryDash } from './player.js';
import { togglePause } from './ui.js';

export function setupInput() {
  document.addEventListener('keydown', (e) => {
    state.keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'p' || e.key === 'Escape') togglePause();
    if (e.code === 'Space' && state.gameState === STATE.PLAYING) tryDash();
  });

  document.addEventListener('keyup', (e) => {
    state.keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('mousemove', (e) => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    const c = document.getElementById('crosshair');
    if (c.style.display === 'block') {
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
    }
  });

  state.renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.mouseDownLeft = true;
      state.mouseClickedThisFrame = true;
      audioInit();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseDownLeft = false;
  });

  state.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();

export function getMouseGroundTarget() {
  _ndc.set(
    (state.mouseX / window.innerWidth) * 2 - 1,
    -(state.mouseY / window.innerHeight) * 2 + 1,
  );
  state.raycaster.setFromCamera(_ndc, state.camera);
  _hit.set(0, 0, 0);
  state.raycaster.ray.intersectPlane(state.groundPlane, _hit);
  return _hit;
}
