// Async preloader for the Quaternius RPG character glTFs.
// Each model ships its own animation set; we cache the loaded scene/animations
// and clone them on demand via SkeletonUtils so every entity has its own
// AnimationMixer driving its own bones.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();

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
