// Tiny pooled particle system. Each particle is a small sphere mesh that
// drifts, fades, and shrinks. We share a single geometry across every
// particle (geometry is identical) and pool the mesh + material so a heavy
// combat moment doesn't allocate dozens of BufferGeometry / Material pairs
// per second — that allocation churn was the main GC source in fights.

import * as THREE from 'three';
import { state } from './state.js';

const _sharedGeo = new THREE.SphereGeometry(0.08, 4, 3);
const _pool = []; // free list of {mesh, material} pairs ready for reuse

function acquire(color) {
  if (_pool.length > 0) {
    const m = _pool.pop();
    m.material.color.setHex(color);
    m.material.opacity = 1;
    m.scale.setScalar(1);
    m.visible = true;
    return m;
  }
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  return new THREE.Mesh(_sharedGeo, mat);
}

function release(mesh) {
  state.scene.remove(mesh);
  mesh.visible = false;
  _pool.push(mesh);
}

export function spawnParticles(x, y, z, color, count = 10, spread = 2.0, gravity = true) {
  for (let i = 0; i < count; i++) {
    const m = acquire(color);
    m.position.set(x, y, z);
    const ang = Math.random() * Math.PI * 2;
    const vy = 1 + Math.random() * 2;
    const sp = (0.5 + Math.random() * 0.5) * spread;
    m.userData = {
      vx: Math.cos(ang) * sp,
      vy,
      vz: Math.sin(ang) * sp,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.7,
      gravity,
    };
    state.scene.add(m);
    state.particles.push(m);
  }
}

// Forcefully clear every live particle and return them all to the pool.
// Used by resetRun() between game sessions.
export function clearParticles() {
  for (const p of state.particles) release(p);
  state.particles.length = 0;
}

export function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.userData.life -= dt;
    if (p.userData.life <= 0) {
      release(p);
      state.particles.splice(i, 1);
      continue;
    }
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;
    if (p.userData.gravity) p.userData.vy -= 9 * dt;
    p.material.opacity = p.userData.life / p.userData.maxLife;
    p.scale.setScalar(0.5 + p.userData.life);
  }
}
