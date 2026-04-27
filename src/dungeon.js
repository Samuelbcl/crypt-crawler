// Procedural dungeon: generation, instanced rendering, collision, and the
// "step on stairs" check that triggers a floor transition.

import * as THREE from 'three';
import { state } from './state.js';
import { GRID_SIZE, CELL, WALL, FLOOR, STAIRS } from './constants.js';

/* ─── GENERATION ─────────────────────────────────────────────── */

export function generateDungeon(floor) {
  state.dungeon = Array(GRID_SIZE).fill(null)
    .map(() => Array(GRID_SIZE).fill(WALL));
  state.rooms = [];

  // Place rooms (rejection sampling)
  const target = 4 + Math.min(3, Math.floor(floor / 2));
  let attempts = 60;
  while (state.rooms.length < target && attempts-- > 0) {
    const w = 4 + Math.floor(Math.random() * 4);
    const h = 4 + Math.floor(Math.random() * 4);
    const x = 1 + Math.floor(Math.random() * (GRID_SIZE - w - 2));
    const z = 1 + Math.floor(Math.random() * (GRID_SIZE - h - 2));

    let overlap = false;
    for (const r of state.rooms) {
      if (x < r.x + r.w + 2 && x + w + 2 > r.x &&
          z < r.z + r.h + 2 && z + h + 2 > r.z) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      state.rooms.push({ x, z, w, h, cx: x + (w >> 1), cz: z + (h >> 1) });
      for (let dz = 0; dz < h; dz++)
        for (let dx = 0; dx < w; dx++)
          state.dungeon[z + dz][x + dx] = FLOOR;
    }
  }

  // Connect via L-corridors (chain)
  for (let i = 1; i < state.rooms.length; i++) {
    carveCorridor(
      state.rooms[i - 1].cx, state.rooms[i - 1].cz,
      state.rooms[i].cx,     state.rooms[i].cz,
    );
  }
  // A couple of extra connections form loops, making layouts less linear
  for (let i = 0; i < 2 && state.rooms.length > 3; i++) {
    const a = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    const b = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    if (a !== b) carveCorridor(a.cx, a.cz, b.cx, b.cz);
  }

  // Stairs in farthest room from start
  let last = state.rooms[0];
  let maxDist = 0;
  for (const r of state.rooms) {
    const dx = r.cx - state.rooms[0].cx;
    const dz = r.cz - state.rooms[0].cz;
    const d = dx * dx + dz * dz;
    if (d > maxDist) { maxDist = d; last = r; }
  }
  const target2 = (last !== state.rooms[0]) ? last : state.rooms[0];
  state.dungeon[target2.cz][target2.cx] = STAIRS;
  state.stairsPos = { x: target2.cx * CELL, z: target2.cz * CELL };
}

function carveCorridor(ax, az, bx, bz) {
  const horizFirst = Math.random() < 0.5;
  if (horizFirst) {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      state.dungeon[az][x] = (state.dungeon[az][x] === STAIRS ? STAIRS : FLOOR);
    }
    for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) {
      state.dungeon[z][bx] = (state.dungeon[z][bx] === STAIRS ? STAIRS : FLOOR);
    }
  } else {
    for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) {
      state.dungeon[z][ax] = (state.dungeon[z][ax] === STAIRS ? STAIRS : FLOOR);
    }
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      state.dungeon[bz][x] = (state.dungeon[bz][x] === STAIRS ? STAIRS : FLOOR);
    }
  }
}

/* ─── RENDERING ──────────────────────────────────────────────── */

export function buildDungeonMesh() {
  // Cleanup old group
  if (state.dungeonGroup) {
    state.scene.remove(state.dungeonGroup);
    state.dungeonGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
  state.dungeonGroup = new THREE.Group();

  // ── Floor: one big plane (fog hides edges)
  const floorGeo = new THREE.PlaneGeometry(GRID_SIZE * CELL + CELL * 2, GRID_SIZE * CELL + CELL * 2);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x4a3e30, // warm stone / wood, castle interior
    roughness: 0.95,
    metalness: 0.05,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set((GRID_SIZE / 2 - 0.5) * CELL, 0, (GRID_SIZE / 2 - 0.5) * CELL);
  floorMesh.receiveShadow = true;
  state.dungeonGroup.add(floorMesh);

  // ── Walls (instanced, only those adjacent to floor)
  const wallCells = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (state.dungeon[z][x] !== WALL) continue;
      let adj = false;
      const neighbors = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
      for (const [dx, dz] of neighbors) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE
            && state.dungeon[nz][nx] !== WALL) {
          adj = true; break;
        }
      }
      if (adj) wallCells.push([x, z]);
    }
  }

  const wallGeo = new THREE.BoxGeometry(CELL, CELL * 1.6, CELL);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8a8a92, // light stone — castle masonry
    roughness: 0.95,
    metalness: 0.05,
  });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
  walls.castShadow = true;
  walls.receiveShadow = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < wallCells.length; i++) {
    const [x, z] = wallCells[i];
    m.makeTranslation(x * CELL, CELL * 0.8, z * CELL);
    walls.setMatrixAt(i, m);
  }
  walls.instanceMatrix.needsUpdate = true;
  state.dungeonGroup.add(walls);

  // ── Stairs marker (glowing ring + light)
  if (state.stairsPos) {
    const sG = new THREE.Group();

    const ringGeo = new THREE.RingGeometry(0.8, 1.0, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd966,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    sG.add(ring);

    const innerG = new THREE.CircleGeometry(0.7, 24);
    innerG.rotateX(-Math.PI / 2);
    const innerM = new THREE.MeshBasicMaterial({
      color: 0xff8c42, transparent: true, opacity: 0.4,
    });
    const inner = new THREE.Mesh(innerG, innerM);
    inner.position.y = 0.015;
    sG.add(inner);

    const stairLight = new THREE.PointLight(0xffd966, 1.5, 8);
    stairLight.position.y = 1.5;
    sG.add(stairLight);

    sG.position.set(state.stairsPos.x, 0, state.stairsPos.z);
    sG.userData.tag = 'stairs';
    state.stairsMesh = sG;
    state.dungeonGroup.add(sG);
  }

  // ── Torches (flickering point lights)
  const numTorches = Math.min(12, Math.floor(state.rooms.length * 1.5));
  for (let i = 0; i < numTorches; i++) {
    const r = state.rooms[i % state.rooms.length];
    const tx = (r.x + Math.floor(Math.random() * r.w)) * CELL;
    const tz = (r.z + Math.floor(Math.random() * r.h)) * CELL;
    const torch = new THREE.PointLight(0xff8c42, 1.6, 12);
    torch.position.set(tx, 1.2, tz);
    torch.userData.flicker = Math.random() * Math.PI * 2;
    torch.userData.baseIntensity = 1.6;
    state.dungeonGroup.add(torch);
  }

  // ── Castle banners — try a handful of placements, hang each on the
  // outer face of a wall cell adjacent to a room cell. Skip silently if
  // no valid neighbour wall is found (rare on small rooms).
  const bannerGeo = new THREE.PlaneGeometry(0.8, 1.6);
  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0x882020,
    side: THREE.DoubleSide,
    roughness: 0.9,
    emissive: 0x220505,
    emissiveIntensity: 0.4,
  });
  const bannerAttempts = 8;
  for (let i = 0; i < bannerAttempts; i++) {
    const r = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    const cellX = r.x + Math.floor(Math.random() * r.w);
    const cellZ = r.z + Math.floor(Math.random() * r.h);
    // Pick one cardinal direction and check if the adjacent cell is a wall.
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
    const wx = cellX + dx, wz = cellZ + dz;
    if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE) continue;
    if (state.dungeon[wz][wx] !== WALL) continue;
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    // Sit the banner just inside the wall cell, facing the room.
    banner.position.set(
      wx * CELL - dx * (CELL * 0.5 - 0.02),
      1.7,
      wz * CELL - dz * (CELL * 0.5 - 0.02),
    );
    banner.rotation.y = Math.atan2(-dx, -dz);
    state.dungeonGroup.add(banner);
  }

  state.scene.add(state.dungeonGroup);
}

/* ─── COLLISION ──────────────────────────────────────────────── */

export function isWallAt(wx, wz) {
  const cx = Math.round(wx / CELL);
  const cz = Math.round(wz / CELL);
  if (cx < 0 || cx >= GRID_SIZE || cz < 0 || cz >= GRID_SIZE) return true;
  return state.dungeon[cz][cx] === WALL;
}

// Slide along walls: try each axis independently so the entity slides
// along walls instead of getting stuck on corners.
export function moveWithCollide(obj, dx, dz, radius = 0.4) {
  if (dx !== 0) {
    const nx = obj.position.x + dx;
    if (!isWallAt(nx + Math.sign(dx) * radius, obj.position.z + radius) &&
        !isWallAt(nx + Math.sign(dx) * radius, obj.position.z - radius)) {
      obj.position.x = nx;
    }
  }
  if (dz !== 0) {
    const nz = obj.position.z + dz;
    if (!isWallAt(obj.position.x + radius, nz + Math.sign(dz) * radius) &&
        !isWallAt(obj.position.x - radius, nz + Math.sign(dz) * radius)) {
      obj.position.z = nz;
    }
  }
}
