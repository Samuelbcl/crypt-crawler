// Procedural dungeon: generation, instanced rendering, collision, and the
// "step on stairs" check that triggers a floor transition.

import * as THREE from 'three';
import { state } from './state.js';
import { GRID_SIZE, CELL, WALL, FLOOR, STAIRS } from './constants.js';
import { getDungeonTemplate, instantiateDungeonProp } from './assets.js';

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

// Quaternius dungeon modules are modelled to roughly fill a 2 m cell when
// scaled by ~2× — FBXLoader returns them at ~1 m and our CELL is 2 m.
// Tweaking this rescales every wall/floor/column at once.
const MODULE_SCALE = 2;

export function buildDungeonMesh() {
  // Cleanup old group. Geometry and materials are owned by the asset cache
  // (shared across runs), so we DON'T dispose them — only detach the wrapper.
  if (state.dungeonGroup) {
    state.scene.remove(state.dungeonGroup);
  }
  state.dungeonGroup = new THREE.Group();

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(MODULE_SCALE, MODULE_SCALE, MODULE_SCALE);
  const pos = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  /* ── Floor: instanced floor tile per floor cell ──────────────── */
  const floorTpl = getDungeonTemplate('Floor_Standard');
  const floorCells = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = state.dungeon[z][x];
      if (t === FLOOR || t === STAIRS) floorCells.push([x, z]);
    }
  }
  const floor = new THREE.InstancedMesh(floorTpl.geometry, floorTpl.material, floorCells.length);
  for (let i = 0; i < floorCells.length; i++) {
    const [x, z] = floorCells[i];
    pos.set(x * CELL, 0, z * CELL);
    quat.identity();
    matrix.compose(pos, quat, scale);
    floor.setMatrixAt(i, matrix);
  }
  floor.instanceMatrix.needsUpdate = true;
  floor.receiveShadow = true;
  state.dungeonGroup.add(floor);

  /* ── Walls: instanced wall block per wall cell adjacent to a floor */
  const wallCells = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (state.dungeon[z][x] !== WALL) continue;
      let adj = false;
      const neighbours = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
      for (const [dx, dz] of neighbours) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE
            && state.dungeon[nz][nx] !== WALL) {
          adj = true; break;
        }
      }
      if (adj) wallCells.push([x, z]);
    }
  }
  const wallTpl = getDungeonTemplate('Wall');
  const walls = new THREE.InstancedMesh(wallTpl.geometry, wallTpl.material, wallCells.length);
  for (let i = 0; i < wallCells.length; i++) {
    const [x, z] = wallCells[i];
    pos.set(x * CELL, 0, z * CELL);
    quat.identity();
    matrix.compose(pos, quat, scale);
    walls.setMatrixAt(i, matrix);
  }
  walls.instanceMatrix.needsUpdate = true;
  walls.receiveShadow = true;
  state.dungeonGroup.add(walls);

  /* ── Columns at room corners ─────────────────────────────────── */
  const cornerCells = [];
  for (const r of state.rooms) {
    cornerCells.push([r.x - 1,        r.z - 1]);
    cornerCells.push([r.x + r.w,      r.z - 1]);
    cornerCells.push([r.x - 1,        r.z + r.h]);
    cornerCells.push([r.x + r.w,      r.z + r.h]);
  }
  const validCorners = cornerCells.filter(([cx, cz]) =>
    cx >= 0 && cx < GRID_SIZE && cz >= 0 && cz < GRID_SIZE
    && state.dungeon[cz][cx] === WALL,
  );
  if (validCorners.length > 0) {
    const colTpl = getDungeonTemplate('Column_Round');
    const cols = new THREE.InstancedMesh(colTpl.geometry, colTpl.material, validCorners.length);
    for (let i = 0; i < validCorners.length; i++) {
      const [x, z] = validCorners[i];
      pos.set(x * CELL, 0, z * CELL);
      quat.identity();
      matrix.compose(pos, quat, scale);
      cols.setMatrixAt(i, matrix);
    }
    cols.instanceMatrix.needsUpdate = true;
    cols.receiveShadow = true;
    state.dungeonGroup.add(cols);
  }

  /* ── Stairs: real flight of stairs + glowing ring trigger marker ──
     The ring marks the "step here to descend" target since the staircase
     itself is decorative — gameplay still uses the cell-centre trigger. */
  if (state.stairsPos) {
    const sG = new THREE.Group();

    const stairs = instantiateDungeonProp('Stairs');
    stairs.scale.setScalar(MODULE_SCALE);
    sG.add(stairs);

    const ringGeo = new THREE.RingGeometry(0.8, 1.0, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd966,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.05;
    sG.add(ring);

    const stairLight = new THREE.PointLight(0xffd966, 1.5, 8);
    stairLight.position.y = 1.6;
    sG.add(stairLight);

    sG.position.set(state.stairsPos.x, 0, state.stairsPos.z);
    sG.userData.tag = 'stairs';
    state.stairsMesh = sG;
    state.dungeonGroup.add(sG);
  }

  /* ── Torches: dynamic point light + decorative wall-torch mesh ── */
  const numTorches = Math.min(12, Math.floor(state.rooms.length * 1.5));
  for (let i = 0; i < numTorches; i++) {
    const r = state.rooms[i % state.rooms.length];
    const tx = r.x + Math.floor(Math.random() * r.w);
    const tz = r.z + Math.floor(Math.random() * r.h);

    const torchMesh = instantiateDungeonProp('Torch_wall');
    torchMesh.scale.setScalar(MODULE_SCALE);
    torchMesh.position.set(tx * CELL, 0, tz * CELL);
    state.dungeonGroup.add(torchMesh);

    const torch = new THREE.PointLight(0xff8c42, 1.6, 12);
    torch.position.set(tx * CELL, 1.5, tz * CELL);
    torch.userData.flicker = Math.random() * Math.PI * 2;
    torch.userData.baseIntensity = 1.6;
    state.dungeonGroup.add(torch);
  }

  /* ── Wall flags / banners — Quaternius Flag_Wall meshes hung on
        room walls so each floor feels like a hall, not a corridor.   */
  const flagAttempts = 6;
  let flagsPlaced = 0;
  for (let i = 0; i < flagAttempts; i++) {
    const r = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    const cellX = r.x + Math.floor(Math.random() * r.w);
    const cellZ = r.z + Math.floor(Math.random() * r.h);
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
    const wx = cellX + dx, wz = cellZ + dz;
    if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE) continue;
    if (state.dungeon[wz][wx] !== WALL) continue;
    const flag = instantiateDungeonProp('Flag_Wall');
    flag.scale.setScalar(MODULE_SCALE);
    flag.position.set(wx * CELL, 0, wz * CELL);
    flag.rotation.y = Math.atan2(-dx, -dz); // face into the room
    state.dungeonGroup.add(flag);
    flagsPlaced++;
    if (flagsPlaced >= 4) break;
  }

  /* ── Decorative props — sprinkle 0-1 per non-start room ──────── */
  const propTypes = ['Chest', 'Barrel', 'Candelabrum', 'Bookcase_Full'];
  for (let i = 1; i < state.rooms.length; i++) {
    if (Math.random() > 0.7) continue;
    const r = state.rooms[i];
    const type = propTypes[Math.floor(Math.random() * propTypes.length)];
    const px = r.x + Math.floor(Math.random() * r.w);
    const pz = r.z + Math.floor(Math.random() * r.h);
    const prop = instantiateDungeonProp(type);
    prop.scale.setScalar(MODULE_SCALE);
    prop.position.set(px * CELL, 0, pz * CELL);
    prop.rotation.y = Math.random() * Math.PI * 2;
    state.dungeonGroup.add(prop);
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
