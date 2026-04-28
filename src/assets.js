// Async preloader for the Quaternius RPG character glTFs.
// Each model ships its own animation set; we cache the loaded scene/animations
// and clone them on demand via SkeletonUtils so every entity has its own
// AnimationMixer driving its own bones.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const fbxLoader = new FBXLoader();

const MODELS = {
  warrior: '/models/Warrior.gltf',
  rogue:   '/models/Rogue.gltf',
  wizard:  '/models/Wizard.gltf',
  cleric:  '/models/Cleric.gltf',
  ranger:  '/models/Ranger.gltf', // archer enemy
  monk:    '/models/Monk.gltf',   // boss
};

const _cache = {}; // name -> { scene, animations }
const _mixers = []; // every spawned mixer registers here for per-frame update

function loadOne(name, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      _cache[name] = { scene: gltf.scene, animations: gltf.animations };
      resolve();
    }, undefined, reject);
  });
}

export async function preloadModels() {
  await Promise.all(Object.entries(MODELS).map(([k, v]) => loadOne(k, v)));
}

/* ─── Dungeon modules (Quaternius FBX) ───────────────────────── */

// Static dungeon props: walls, floor tiles, columns, stairs, decorative
// items. Loaded once at boot. For high-count modules (Wall, Floor) we
// extract the geometry+material so dungeon.js can build an InstancedMesh
// (one draw call for hundreds of cells); for one-off props we just clone
// the cached scene.

const DUNGEON_MODULES = {
  // Architecture
  Wall:           '/dungeon/Wall.fbx',
  Wall_Broken:    '/dungeon/Wall_Broken.fbx',
  Floor_Standard: '/dungeon/Floor_Standard.fbx',
  Column_Round:   '/dungeon/Column_Round.fbx',
  Stairs:         '/dungeon/Stairs.fbx',
  Doors_RoundArch:'/dungeon/Doors_RoundArch.fbx',
  Window_Open:    '/dungeon/Window_Open.fbx',
  // Wall mounts
  Flag_Wall:      '/dungeon/Flag_Wall.fbx',
  Flag_Wall2:     '/dungeon/Flag_Wall2.fbx',
  Torch_wall:     '/dungeon/Torch_wall.fbx',
  // Centerpieces
  Statue_Stag:    '/dungeon/Statue_Stag.fbx',
  Statue_Fox:     '/dungeon/Statue_Fox.fbx',
  Carpet:         '/dungeon/Carpet.fbx',
  // Tall props (against walls / corners)
  Bookcase_Full:  '/dungeon/Bookcase_Full.fbx',
  Bookcase_Empty: '/dungeon/Bookcase_Empty.fbx',
  Candelabrum:    '/dungeon/Candelabrum.fbx',
  Candelabrum_tall:'/dungeon/Candelabrum_tall.fbx',
  // Small clutter
  Chest:          '/dungeon/Chest.fbx',
  Barrel:         '/dungeon/Barrel.fbx',
  Crate:          '/dungeon/Crate.fbx',
  Pot1:           '/dungeon/Pot1.fbx',
  Pot2:           '/dungeon/Pot2.fbx',
  Pot3:           '/dungeon/Pot3.fbx',
  Bones:          '/dungeon/Bones.fbx',
  Skull:          '/dungeon/Skull.fbx',
  Candles_1:      '/dungeon/Candles_1.fbx',
};

// Y anchor per module:
//   'bottom' (default) — shift so the bottom of the mesh sits at y=0.
//   'top'              — shift so the TOP of the mesh sits at y=0
//                        (used for floor tiles so player feet at y=0
//                         aren't clipped by the floor surface).
const DUNGEON_ANCHORS = {
  Floor_Standard: 'top',
};

// Target footprint (largest XZ size, in world units) that each module
// should occupy after auto-scaling. Walls/floors fill exactly one cell
// (CELL = 2). Props are smaller. Stairs span a bit more than a cell.
const DUNGEON_TARGETS = {
  // Architecture
  Wall:            2.0,
  Wall_Broken:     2.0,
  Floor_Standard:  2.0,
  Column_Round:    0.7,
  Stairs:          2.4,
  Doors_RoundArch: 2.0,
  Window_Open:     1.6,
  // Wall mounts
  Flag_Wall:       1.4,
  Flag_Wall2:      1.4,
  Torch_wall:      0.7,
  // Centerpieces
  Statue_Stag:     1.2,
  Statue_Fox:      1.0,
  Carpet:          1.6,
  // Tall props
  Bookcase_Full:   1.4,
  Bookcase_Empty:  1.4,
  Candelabrum:     1.0,
  Candelabrum_tall:0.8,
  // Small clutter
  Chest:           0.9,
  Barrel:          0.7,
  Crate:           0.8,
  Pot1:            0.6,
  Pot2:            0.5,
  Pot3:            0.6,
  Bones:           1.2,
  Skull:           0.4,
  Candles_1:       0.5,
};

const _dungeonCache = {}; // name -> { scene, geometry, material, fitScale }

function loadOneDungeon(name, url) {
  return new Promise((resolve, reject) => {
    fbxLoader.load(url, (group) => {
      // FBXLoader already applies the FBX file's UpAxis conversion, so
      // we don't add any rotation here — adding -90°X on top toppled
      // walls onto their side.
      group.updateMatrixWorld(true);

      // Bake every parent transform (root scale from any FBX cm→m
      // conversion, mesh-local rotations) into a cloned geometry so the
      // bbox we measure matches what InstancedMesh will render with an
      // identity matrix.
      let geometry = null, material = null;
      group.traverse((o) => {
        if (!geometry && o.isMesh) {
          geometry = o.geometry.clone();
          geometry.applyMatrix4(o.matrixWorld);
          material = o.material;
        }
      });

      let fitScale = 1, yShift = 0;
      if (geometry) {
        geometry.computeBoundingBox();
        // 'top'    → align the top face of the mesh to y=0 (used for
        //            floor tiles so player feet at y=0 aren't clipped).
        // 'bottom' → align the bottom of the mesh to y=0 (everything
        //            else: walls, columns, props sit on the floor).
        const anchor = DUNGEON_ANCHORS[name] ?? 'bottom';
        yShift = (anchor === 'top')
          ? -geometry.boundingBox.max.y
          : -geometry.boundingBox.min.y;
        if (Math.abs(yShift) > 0.001) {
          geometry.translate(0, yShift, 0);
          geometry.computeBoundingBox();
        }
        const size = new THREE.Vector3();
        geometry.boundingBox.getSize(size);
        const dom = Math.max(size.x, size.z);
        if (dom > 0.001) {
          const target = DUNGEON_TARGETS[name] ?? 2.0;
          fitScale = target / dom;
        }
      }

      _dungeonCache[name] = { scene: group, geometry, material, fitScale, yShift };
      resolve();
    }, undefined, reject);
  });
}

export async function preloadDungeon() {
  await Promise.all(Object.entries(DUNGEON_MODULES).map(([k, v]) => loadOneDungeon(k, v)));
}

// Returns { geometry, material, fitScale } for high-count InstancedMesh
// use. Caller composes per-instance matrices using fitScale on the
// scale axis so each instance fits one cell.
export function getDungeonTemplate(name) {
  const m = _dungeonCache[name];
  if (!m) throw new Error('Dungeon module not preloaded: ' + name);
  return { geometry: m.geometry, material: m.material, fitScale: m.fitScale };
}

// Returns a fresh clone of the loaded FBX scene with fitScale and the
// matching yShift already applied — for unique props (Stairs, Chest,
// Bookcase…) placed once per floor.
export function instantiateDungeonProp(name) {
  const m = _dungeonCache[name];
  if (!m) throw new Error('Dungeon module not preloaded: ' + name);
  const clone = m.scene.clone(true);
  clone.scale.setScalar(m.fitScale);
  // The InstancedMesh path bakes yShift into the cloned geometry; the
  // prop-clone path renders the original group, so we mirror the same
  // shift on the clone's position (scaled to match).
  clone.position.y = m.yShift * m.fitScale;
  clone.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return clone;
}

// Returns { root, mixer, actions } — root is a fresh clone with skinning preserved,
// mixer drives it, and actions[name] is a ready-to-play AnimationAction.
export function instantiate(name) {
  const cached = _cache[name];
  if (!cached) throw new Error('Model not preloaded: ' + name);

  const root = cloneSkinned(cached.scene);
  root.traverse((o) => {
    if (o.isMesh) {
      // Shadows on every SkinnedMesh blew up the shadow pass — each frame
      // the directional light had to re-render skinned bones into the depth
      // map. The ambient + torch lighting reads fine without per-character
      // shadows, and gameplay perf jumps a lot.
      o.castShadow = false;
      o.receiveShadow = false;
      // SkinnedMesh bounding boxes don't update when bones animate, so the
      // mesh can get incorrectly frustum-culled and disappear at certain
      // angles. Skip culling — character meshes are small and few.
      o.frustumCulled = false;
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of cached.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  _mixers.push(mixer);
  return { root, mixer, actions };
}

// Disconnects a mixer from per-frame updates. Call when the entity is removed.
export function releaseMixer(mixer) {
  const i = _mixers.indexOf(mixer);
  if (i >= 0) _mixers.splice(i, 1);
}

export function updateMixers(dt) {
  for (const m of _mixers) m.update(dt);
}

// A flat dark disc placed under a character to fake an ambient occlusion
// "grounding" shadow. Way cheaper than a real cast shadow on a SkinnedMesh
// (which would re-skin every bone into the shadow depth map each frame),
// and visually reads almost identical from the gameplay camera angle.
export function createShadowDisc(radius) {
  const geo = new THREE.CircleGeometry(radius, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.015; // sit just above the floor to avoid z-fighting
  m.renderOrder = 1;    // draw after the floor plane
  return m;
}

// Plays one action and stops all others on the same mixer.
// Use `crossfade` (seconds) for smooth transitions between looped states.
// `timeScale` overrides playback speed; `fitDuration` scales the clip so it
// plays end-to-end in that many seconds (useful when a long attack anim has
// to fit a short gameplay attack window).
export function playOnly(actions, name, opts = {}) {
  const { crossfade = 0.15, loop = true, timeScale, fitDuration } = opts;
  const target = actions[name];
  if (!target) return null;
  for (const k in actions) {
    if (k !== name && actions[k].isRunning()) {
      actions[k].fadeOut(crossfade);
    }
  }
  target.reset();
  if (fitDuration) {
    target.timeScale = target.getClip().duration / fitDuration;
  } else {
    target.timeScale = timeScale ?? 1;
  }
  target.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  target.clampWhenFinished = !loop;
  target.fadeIn(crossfade).play();
  return target;
}
