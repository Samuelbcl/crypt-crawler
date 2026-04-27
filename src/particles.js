// Tiny particle system. spawnParticles() creates short-lived sphere meshes
// that drift, fade, and shrink. Updated each frame via updateParticles().

import * as THREE from 'three';
import { state } from './state.js';

export function spawnParticles(x, y, z, color, count = 10, spread = 2.0, gravity = true) {
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.08, 4, 3);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const m = new THREE.Mesh(geo, mat);
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

export function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.userData.life -= dt;
    if (p.userData.life <= 0) {
      state.scene.remove(p);
      p.geometry.dispose();
      p.material.dispose();
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
