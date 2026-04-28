// Procedural dungeon: generation, instanced rendering, collision, and the
// "step on stairs" check that triggers a floor transition.

import * as THREE from 'three';
import { state } from './state.js';
import { GRID_SIZE, CELL, WALL, FLOOR, STAIRS } from './constants.js';
import { getDungeonTemplate, instantiateDungeonProp } from './assets.js';
import { getTheme, pickRandomTheme } from './themes.js';

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

  // Tag every room with a hand-designed theme. Start room stays empty so
  // the player gets a calm intro; the stairs/boss room gets the "throne"
  // treatment for that "you've arrived" feeling. All others roll random
  // among the themes whose minSize fits.
  for (const r of state.rooms) r.theme = pickRandomTheme(r);
  if (state.rooms.length > 0) state.rooms[0].theme = 'empty';
  state.rooms[state.rooms.indexOf(target2)].theme = 'throne_room';
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

  // Split wall placements into normal vs broken variants so each set
  // becomes its own InstancedMesh — lets us mix two wall meshes without
  // losing the one-draw-call-per-wall-type win.
  const mainPlacements = [];
  const brokenPlacements = [];
  for (const p of wallPlacements) {
    if (Math.random() < 0.07) brokenPlacements.push(p);
    else mainPlacements.push(p);
  }

  const buildOrientedWalls = (templateName, list) => {
    const tpl = getDungeonTemplate(templateName);
    const mesh = new THREE.InstancedMesh(tpl.geometry, tpl.material, list.length);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const sc = new THREE.Vector3(tpl.fitScale, tpl.fitScale, tpl.fitScale);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      const { x, z, dx, dz } = list[i];
      // Place at the boundary midpoint between this floor cell and the
      // adjacent wall cell, embedded 5 cm down to hide any seam.
      pos.set((x + 0.5 * dx) * CELL, -0.05, (z + 0.5 * dz) * CELL);
      // Rotate so the wall's default front face (+Z) points at the floor.
      quat.setFromAxisAngle(yAxis, Math.atan2(-dx, -dz));
      matrix.compose(pos, quat, sc);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  if (mainPlacements.length > 0)   state.dungeonGroup.add(buildOrientedWalls('Wall',        mainPlacements));
  if (brokenPlacements.length > 0) state.dungeonGroup.add(buildOrientedWalls('Wall_Broken', brokenPlacements));

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

  /* ── Apply each room's hand-designed theme. Torches, banners, and
        every prop are now decided by themes.js per room. */
  for (const r of state.rooms) placeTheme(r);

  state.scene.add(state.dungeonGroup);
}

// Mounts a prop on the room-facing edge of an adjacent wall cell.
// `edge` is { wx, wz, dx, dz } where (wx, wz) is the wall cell and
// (dx, dz) is the direction FROM the floor to that wall.
function placeAtWallEdge(name, edge, y) {
  const prop = instantiateDungeonProp(name);
  prop.position.set(
    edge.wx * CELL - edge.dx * (CELL * 0.5 - 0.05),
    y,
    edge.wz * CELL - edge.dz * (CELL * 0.5 - 0.05),
  );
  prop.rotation.y = Math.atan2(-edge.dx, -edge.dz);
  state.dungeonGroup.add(prop);
}

/* ─── Theme application ──────────────────────────────────────── */

function applyRotation(prop, rotKind, opts = {}) {
  if (rotKind === 'random') {
    prop.rotation.y = Math.random() * Math.PI * 2;
  } else if (rotKind === 'align') {
    // Snap to a cardinal axis aligned with the room (carpets, runners).
    prop.rotation.y = (opts.roomLong === 'x') ? Math.PI / 2 : 0;
  } else if (rotKind === 'cornerOut') {
    // Face from the corner toward the room centre — used for tall props
    // tucked into corners (bookcases, candelabras) so their fronts are
    // visible from the middle of the room.
    prop.rotation.y = Math.atan2(opts.dirToCentreX || 0, opts.dirToCentreZ || 0);
  }
  // 'none' or unknown → leave rotation at 0
}

function placeTheme(room) {
  const theme = getTheme(room.theme);
  const roomLong = (room.w >= room.h) ? 'x' : 'z';

  // Pre-shuffle the floor cells so multiple "scattered" placements don't
  // pile on the same cell.
  const innerCells = [];
  for (let dz = 0; dz < room.h; dz++) {
    for (let dx = 0; dx < room.w; dx++) {
      innerCells.push([room.x + dx, room.z + dz]);
    }
  }
  for (let i = innerCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [innerCells[i], innerCells[j]] = [innerCells[j], innerCells[i]];
  }
  let cellCursor = 0;
  function nextCell() {
    if (cellCursor >= innerCells.length) return null;
    return innerCells[cellCursor++];
  }

  // Interior corner cells of the room (always 4, in TL TR BL BR order).
  const corners = [
    [room.x,             room.z,             +1, +1],
    [room.x + room.w - 1,room.z,             -1, +1],
    [room.x,             room.z + room.h - 1,+1, -1],
    [room.x + room.w - 1,room.z + room.h - 1,-1, -1],
  ];

  /* ── Floor placements (centerpiece, corners, scattered, etc.) ── */
  for (const p of theme.placements) {
    const count = p.count ?? 1;
    if (p.where === 'center') {
      const prop = instantiateDungeonProp(p.type);
      prop.position.set(room.cx * CELL, 0, room.cz * CELL);
      applyRotation(prop, p.rot, { roomLong });
      state.dungeonGroup.add(prop);

    } else if (p.where === 'centerLine') {
      // For carpets / runners — single prop centred but aligned along
      // the long axis of the room.
      const prop = instantiateDungeonProp(p.type);
      prop.position.set(room.cx * CELL, 0, room.cz * CELL);
      applyRotation(prop, p.rot, { roomLong });
      state.dungeonGroup.add(prop);

    } else if (p.where === 'corners') {
      // Drop one prop per interior corner, up to `count`.
      for (let i = 0; i < count && i < corners.length; i++) {
        const [cx, cz, dirX, dirZ] = corners[i];
        const prop = instantiateDungeonProp(p.type);
        prop.position.set(cx * CELL, 0, cz * CELL);
        applyRotation(prop, p.rot, { dirToCentreX: dirX, dirToCentreZ: dirZ });
        state.dungeonGroup.add(prop);
      }

    } else if (p.where === 'scattered') {
      for (let i = 0; i < count; i++) {
        const cell = nextCell();
        if (!cell) break;
        const [cx, cz] = cell;
        const prop = instantiateDungeonProp(p.type);
        prop.position.set(cx * CELL, 0, cz * CELL);
        applyRotation(prop, p.rot);
        state.dungeonGroup.add(prop);
      }
    }
  }

  /* ── Wall-mounted props (banners / torches / windows) ────────── */
  for (const wm of (theme.wallMounted || [])) {
    let placed = 0;
    for (let attempt = 0; attempt < wm.count * 4 && placed < wm.count; attempt++) {
      const edge = findEdgeOnRoom(room);
      if (!edge) break;
      const isTorch = (wm.type === 'Torch_wall');
      const yMount = isTorch ? 1.2 : (wm.type === 'Window_Open' ? 1.5 : 1.4);
      placeAtWallEdge(wm.type, edge, yMount);
      // Torches also drop a flickering point light in the room.
      if (isTorch) addTorchLightForEdge(edge);
      placed++;
    }
  }
}

// Same pattern as the global helper but constrained to a specific room.
function findEdgeOnRoom(room, attempts = 8) {
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
  for (let a = 0; a < attempts; a++) {
    const cellX = room.x + Math.floor(Math.random() * room.w);
    const cellZ = room.z + Math.floor(Math.random() * room.h);
    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
    const wx = cellX + dx, wz = cellZ + dz;
    if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE) continue;
    if (state.dungeon[wz][wx] !== WALL) continue;
    return { wx, wz, dx, dz };
  }
  return null;
}

function addTorchLightForEdge(edge) {
  const torch = new THREE.PointLight(0xff8c42, 1.6, 12);
  torch.position.set(edge.wx * CELL - edge.dx * 0.6, 1.7, edge.wz * CELL - edge.dz * 0.6);
  torch.userData.flicker = Math.random() * Math.PI * 2;
  torch.userData.baseIntensity = 1.6;
  state.dungeonGroup.add(torch);
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
