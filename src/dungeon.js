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

// Build an InstancedMesh from a dungeon-module template at a list of
// cell positions, applying the template's per-module fitScale so each
// instance fits one CELL footprint. yOffset shifts every instance
// vertically (used to embed walls/columns slightly into the floor so
// any tiny gap at the floor-wall seam is hidden).
function instancedFromCells(template, cells, yOffset = 0) {
  const mesh = new THREE.InstancedMesh(template.geometry, template.material, cells.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(template.fitScale, template.fitScale, template.fitScale);
  const pos = new THREE.Vector3();
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = cells[i];
    pos.set(x * CELL, yOffset, z * CELL);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function buildDungeonMesh() {
  // Geometry and materials are owned by the asset cache (shared across
  // runs), so we DON'T dispose them — only detach the wrapper.
  if (state.dungeonGroup) {
    state.scene.remove(state.dungeonGroup);
  }
  state.dungeonGroup = new THREE.Group();

  /* ── Floor: instanced floor tile per floor cell ──────────────── */
  const floorTpl = getDungeonTemplate('Floor_Standard');
  const floorCells = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = state.dungeon[z][x];
      if (t === FLOOR || t === STAIRS) floorCells.push([x, z]);
    }
  }
  const floor = instancedFromCells(floorTpl, floorCells);
  floor.receiveShadow = true;
  state.dungeonGroup.add(floor);

  /* ── Walls: one slab per FLOOR-edge that touches a wall.

     Iterating wall cells and placing one mesh at each (the box-wall
     approach) leaves the cell mostly empty for thin modular walls,
     producing the gaps visible in earlier screenshots. By iterating
     floor cells instead and placing a wall at every cardinal boundary
     that faces a wall (or the grid edge), we get a continuous skirt of
     wall slabs around every room and corridor — perpendicular pairs
     meet at the corners and form a closed L. */
  const wallPlacements = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = state.dungeon[z][x];
      if (t !== FLOOR && t !== STAIRS) continue;
      const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
      for (const [dx, dz] of dirs) {
        const nx = x + dx, nz = z + dz;
        const isWall = nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE
                      || state.dungeon[nz][nx] === WALL;
        if (isWall) wallPlacements.push({ x, z, dx, dz });
      }
    }
  }

  const wallTpl = getDungeonTemplate('Wall');
  const walls = new THREE.InstancedMesh(wallTpl.geometry, wallTpl.material, wallPlacements.length);
  {
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const wallScale = new THREE.Vector3(wallTpl.fitScale, wallTpl.fitScale, wallTpl.fitScale);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    for (let i = 0; i < wallPlacements.length; i++) {
      const { x, z, dx, dz } = wallPlacements[i];
      // Place at the boundary midpoint between this floor cell and the
      // adjacent wall cell, embedded 5 cm down to hide any seam.
      pos.set(
        (x + 0.5 * dx) * CELL,
        -0.05,
        (z + 0.5 * dz) * CELL,
      );
      // Rotate so the wall's default front face (+Z) points at the floor.
      quat.setFromAxisAngle(yAxis, Math.atan2(-dx, -dz));
      matrix.compose(pos, quat, wallScale);
      walls.setMatrixAt(i, matrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    walls.receiveShadow = true;
  }
  state.dungeonGroup.add(walls);

  /* ── Columns at the four interior corners of every room. Sit on the
        floor cells (no collision change — player walks past them). */
  const interiorCorners = [];
  for (const r of state.rooms) {
    if (r.w >= 2 && r.h >= 2) {
      interiorCorners.push([r.x,             r.z]);
      interiorCorners.push([r.x + r.w - 1,   r.z]);
      interiorCorners.push([r.x,             r.z + r.h - 1]);
      interiorCorners.push([r.x + r.w - 1,   r.z + r.h - 1]);
    }
  }
  if (interiorCorners.length > 0) {
    const cols = instancedFromCells(getDungeonTemplate('Column_Round'), interiorCorners, -0.05);
    cols.receiveShadow = true;
    state.dungeonGroup.add(cols);
  }

  /* ── Stairs: real flight of stairs + glowing ring trigger marker ──
     The ring marks the "step here to descend" target since the staircase
     itself is decorative — gameplay still uses the cell-centre trigger. */
  if (state.stairsPos) {
    const sG = new THREE.Group();

    sG.add(instantiateDungeonProp('Stairs'));

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

  /* ── Torches: hung on a wall facing into a room. Each placement is a
        decorative mesh + a flickering PointLight just inside the room. */
  const numTorches = Math.min(12, Math.floor(state.rooms.length * 1.5));
  let torchesPlaced = 0;
  for (let attempt = 0; attempt < numTorches * 3 && torchesPlaced < numTorches; attempt++) {
    const r = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    const cellX = r.x + Math.floor(Math.random() * r.w);
    const cellZ = r.z + Math.floor(Math.random() * r.h);
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
    const wx = cellX + dx, wz = cellZ + dz;
    if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE) continue;
    if (state.dungeon[wz][wx] !== WALL) continue;

    // Mount the torch on the room-facing edge of the wall cell, ~1.2m
    // up the wall (chest height). The bracket's "back" sits flush with
    // the wall surface so it sticks into the room, not into the wall.
    const torchMesh = instantiateDungeonProp('Torch_wall');
    torchMesh.position.set(
      wx * CELL - dx * (CELL * 0.5 - 0.05),
      1.2,
      wz * CELL - dz * (CELL * 0.5 - 0.05),
    );
    torchMesh.rotation.y = Math.atan2(-dx, -dz);
    state.dungeonGroup.add(torchMesh);

    // PointLight slightly further out so the room actually gets lit.
    const torch = new THREE.PointLight(0xff8c42, 1.6, 12);
    torch.position.set(wx * CELL - dx * 0.6, 1.7, wz * CELL - dz * 0.6);
    torch.userData.flicker = Math.random() * Math.PI * 2;
    torch.userData.baseIntensity = 1.6;
    state.dungeonGroup.add(torch);

    torchesPlaced++;
  }

  /* ── Wall flags / banners — hung on a wall facing into a room ── */
  let flagsPlaced = 0;
  for (let i = 0; i < 6 && flagsPlaced < 4; i++) {
    const r = state.rooms[Math.floor(Math.random() * state.rooms.length)];
    const cellX = r.x + Math.floor(Math.random() * r.w);
    const cellZ = r.z + Math.floor(Math.random() * r.h);
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
    const wx = cellX + dx, wz = cellZ + dz;
    if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE) continue;
    if (state.dungeon[wz][wx] !== WALL) continue;
    // Hang the banner on the room-facing edge of the wall, raised so
    // the top sits high near the ceiling (~3 m).
    const flag = instantiateDungeonProp('Flag_Wall');
    flag.position.set(
      wx * CELL - dx * (CELL * 0.5 - 0.05),
      1.4,
      wz * CELL - dz * (CELL * 0.5 - 0.05),
    );
    flag.rotation.y = Math.atan2(-dx, -dz);
    state.dungeonGroup.add(flag);
    flagsPlaced++;
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
