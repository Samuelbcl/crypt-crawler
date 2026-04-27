// Three.js renderer/scene/camera setup, plus camera follow with screen-shake,
// and torch-flicker for ambient lights tagged via userData.flicker.

import * as THREE from 'three';
import { state, _scratchV3 } from './state.js';

export function initThree() {
  const container = document.getElementById('game-container');

  state.renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.5;
  container.appendChild(state.renderer.domElement);

  state.scene = new THREE.Scene();
  // Warm brown background + matching fog — castle interior lit by torches.
  state.scene.background = new THREE.Color(0x1a1410);
  state.scene.fog = new THREE.FogExp2(0x1a1410, 0.03);

  state.camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  state.camera.position.set(0, 14, 10);
  state.camera.lookAt(0, 0, 0);

  // Warm interior ambient (torchlit hall feel) + slightly warmer directional.
  const amb = new THREE.AmbientLight(0xb09a70, 0.85);
  state.scene.add(amb);

  const dir = new THREE.DirectionalLight(0xffd090, 1.3);
  dir.position.set(20, 30, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 80;
  dir.shadow.camera.left = -25;
  dir.shadow.camera.right = 25;
  dir.shadow.camera.top = 25;
  dir.shadow.camera.bottom = -25;
  state.scene.add(dir);

  state.raycaster = new THREE.Raycaster();
  state.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  window.addEventListener('resize', onResize);
}

export function onResize() {
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// 3rd-person follow with smoothing + procedural shake.
export function updateCamera(dt) {
  if (!state.player) return;

  const target = _scratchV3.copy(state.player.position);
  const offY = 13;
  const offZ = 9;
  const desiredX = target.x;
  const desiredY = target.y + offY;
  const desiredZ = target.z + offZ;

  const lerp = Math.min(1, dt * 8);
  state.camera.position.x += (desiredX - state.camera.position.x) * lerp;
  state.camera.position.y += (desiredY - state.camera.position.y) * lerp;
  state.camera.position.z += (desiredZ - state.camera.position.z) * lerp;

  if (state.shakeAmount > 0) {
    state.camera.position.x += (Math.random() - 0.5) * state.shakeAmount;
    state.camera.position.y += (Math.random() - 0.5) * state.shakeAmount;
    state.camera.position.z += (Math.random() - 0.5) * state.shakeAmount;
    state.shakeAmount -= state.shakeDecay * dt;
    if (state.shakeAmount < 0) state.shakeAmount = 0;
  }

  state.camera.lookAt(target.x, target.y + 0.5, target.z);
}

export function updateTorches(dt) {
  if (!state.dungeonGroup) return;
  const t = performance.now() * 0.005;
  state.dungeonGroup.traverse((o) => {
    if (o.isPointLight && o.userData.flicker !== undefined) {
      o.intensity = o.userData.baseIntensity *
        (0.7 + Math.sin(t + o.userData.flicker) * 0.15 + Math.random() * 0.1);
    }
  });
}

export function shake(amount, decay = 0.5) {
  state.shakeAmount = Math.max(state.shakeAmount, amount);
  state.shakeDecay = decay;
}

// Flat arrow that hovers in front of the player and rotates each frame
// to point at the stairs. Geometry is built once (same shape for every
// run); position/rotation/visibility are driven by updateGuidanceArrow().
export function createGuidanceArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);     // tip
  shape.lineTo(-0.35, 0.05);
  shape.lineTo(-0.13, 0.05);
  shape.lineTo(-0.13, -0.4); // shaft back-left
  shape.lineTo(0.13, -0.4);  // shaft back-right
  shape.lineTo(0.13, 0.05);
  shape.lineTo(0.35, 0.05);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // Lay the arrow flat. rotateX(+π/2) maps the shape's +Y (tip) onto world
  // +Z, so when we set rotation.y = atan2(ux, uz) the tip lines up with
  // the (ux, uz) direction vector.
  geo.rotateX(Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd966,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

// Walks an Object3D subtree and disposes its GPU resources.
// Skips InstancedMesh's shared geometry/material — those belong to the dungeon
// builder which owns its own cleanup.
export function disposeNode(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
