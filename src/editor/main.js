// Theme editor — visual builder for the JSON consumed by src/themes.js.
// State lives entirely in this file, autosaved to localStorage. The user
// composes a theme via dropdowns, sees a top-down emoji preview, and
// copies the resulting JSON back into themes.js by hand.

import './style.css';

/* ─── Catalog of available props (mirror DUNGEON_MODULES in assets.js) ─ */

const FLOOR_PROPS = [
  // Centerpieces
  'Statue_Stag', 'Statue_Fox', 'Carpet',
  // Furniture
  'Bookcase_Full', 'Bookcase_Empty', 'Candelabrum', 'Candelabrum_tall',
  // Clutter
  'Chest', 'Barrel', 'Crate',
  'Pot1', 'Pot2', 'Pot3',
  'Bones', 'Skull', 'Candles_1',
];

const WALL_PROPS = [
  'Flag_Wall', 'Flag_Wall2', 'Torch_wall', 'Window_Open',
];

// Top-down emoji used in the preview grid for each prop type.
const EMOJI = {
  Statue_Stag: '🦌', Statue_Fox: '🦊', Carpet: '🟥',
  Bookcase_Full: '📚', Bookcase_Empty: '🗄', Candelabrum: '🕯', Candelabrum_tall: '🕯',
  Chest: '🟫', Barrel: '🛢', Crate: '📦',
  Pot1: '🏺', Pot2: '🏺', Pot3: '🏺',
  Bones: '🦴', Skull: '💀', Candles_1: '🕯',
  Flag_Wall: '🚩', Flag_Wall2: '🏳', Torch_wall: '🔥', Window_Open: '🪟',
};

const WHERE_OPTIONS = [
  { v: 'center',     label: 'center'     },
  { v: 'centerLine', label: 'centerLine' },
  { v: 'longEnd',    label: 'longEnd'    },
  { v: 'corners',    label: 'corners'    },
  { v: 'scattered',  label: 'scattered'  },
];

const ROT_OPTIONS = [
  { v: 'random',    label: 'random'    },
  { v: 'align',     label: 'align'     },
  { v: 'cornerOut', label: 'cornerOut' },
  { v: 'none',      label: 'none'      },
];

/* ─── State + persistence ─────────────────────────────────────── */

const STORAGE_KEY = 'cryptCrawler.editor.state';

const defaultState = () => ({
  name: 'my_theme',
  minW: 4,
  minH: 4,
  placements: [],
  wallMounted: [],
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (_) { return defaultState(); }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

const state = loadState();

/* ─── DOM refs ────────────────────────────────────────────────── */

const $name = document.getElementById('theme-name');
const $minW = document.getElementById('min-w');
const $minH = document.getElementById('min-h');
const $placementsList = document.getElementById('placements-list');
const $wallList       = document.getElementById('wallmounted-list');
const $previewGrid    = document.getElementById('preview-grid');
const $jsonOutput     = document.getElementById('json-output');

/* ─── Helpers ─────────────────────────────────────────────────── */

function makeSelect(options, value, onChange) {
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.v ?? o;
    opt.textContent = o.label ?? o;
    if ((o.v ?? o) === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeNumberInput(value, onChange, min = 1, max = 8) {
  const i = document.createElement('input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.value = String(value);
  i.addEventListener('input', () => {
    const n = parseInt(i.value, 10);
    if (!isNaN(n)) onChange(n);
  });
  return i;
}

function makeRemoveBtn(onClick) {
  const b = document.createElement('button');
  b.className = 'remove';
  b.textContent = '×';
  b.title = 'Supprimer';
  b.addEventListener('click', onClick);
  return b;
}

/* ─── Rendering ───────────────────────────────────────────────── */

function render() {
  $name.value = state.name;
  $minW.value = state.minW;
  $minH.value = state.minH;
  renderPlacements();
  renderWallMounted();
  renderPreview();
  renderJson();
  saveState();
}

function renderPlacements() {
  $placementsList.innerHTML = '';
  state.placements.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'entry';

    row.appendChild(makeSelect(
      FLOOR_PROPS.map((t) => ({ v: t, label: t })),
      p.type,
      (v) => { p.type = v; render(); },
    ));
    row.appendChild(makeSelect(
      WHERE_OPTIONS,
      p.where,
      (v) => { p.where = v; render(); },
    ));
    row.appendChild(makeSelect(
      ROT_OPTIONS,
      p.rot,
      (v) => { p.rot = v; render(); },
    ));
    row.appendChild(makeNumberInput(
      p.count ?? 1,
      (n) => { p.count = n; render(); },
      1, 8,
    ));
    row.appendChild(makeRemoveBtn(() => {
      state.placements.splice(i, 1);
      render();
    }));

    $placementsList.appendChild(row);
  });
}

function renderWallMounted() {
  $wallList.innerHTML = '';
  state.wallMounted.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'entry entry-wall';

    row.appendChild(makeSelect(
      WALL_PROPS.map((t) => ({ v: t, label: t })),
      w.type,
      (v) => { w.type = v; render(); },
    ));
    row.appendChild(makeNumberInput(
      w.count ?? 1,
      (n) => { w.count = n; render(); },
      1, 8,
    ));
    row.appendChild(makeRemoveBtn(() => {
      state.wallMounted.splice(i, 1);
      render();
    }));

    $wallList.appendChild(row);
  });
}

/* ── Top-down preview. Builds a (W+2)×(H+2) grid where the inner
      (W×H) area is the room and the outside ring is wall. Each
      placement gets dropped at the cells that match its 'where' rule. */
function renderPreview() {
  const W = state.minW;
  const H = state.minH;

  // Initialise the preview grid: walls around the room, dots inside.
  const totalW = W + 2;
  const totalH = H + 2;
  const cells = [];
  for (let z = 0; z < totalH; z++) {
    const row = [];
    for (let x = 0; x < totalW; x++) {
      const isWall = (x === 0 || x === totalW - 1 || z === 0 || z === totalH - 1);
      row.push({ glyph: isWall ? '▓' : '·', wall: isWall });
    }
    cells.push(row);
  }

  // Convert (room x, z) to grid coords (offset by 1 because outer ring).
  const at = (x, z) => cells[z + 1][x + 1];

  const cx = Math.floor(W / 2);
  const cz = Math.floor(H / 2);
  const roomLong = (W >= H) ? 'x' : 'z';

  // Mark the centre with a 'D' so the user always sees it.
  at(cx, cz).glyph = 'D';

  // Apply each floor placement to the preview grid.
  for (const p of state.placements) {
    const e = EMOJI[p.type] || '?';
    if (p.where === 'center' || p.where === 'centerLine') {
      at(cx, cz).glyph = e;
    } else if (p.where === 'longEnd') {
      const off = 2;
      let x = cx, z = cz;
      if (roomLong === 'x') x = Math.min(W - 1, cx + off);
      else                  z = Math.min(H - 1, cz + off);
      at(x, z).glyph = e;
    } else if (p.where === 'corners') {
      const corners = [[0,0],[W-1,0],[0,H-1],[W-1,H-1]];
      const n = Math.min(p.count ?? 4, 4);
      for (let i = 0; i < n; i++) at(corners[i][0], corners[i][1]).glyph = e;
    } else if (p.where === 'scattered') {
      // Random-ish positions inside the room (deterministic per type for
      // a stable preview).
      const seed = [...p.type].reduce((s, c) => s + c.charCodeAt(0), 0);
      const n = p.count ?? 1;
      for (let i = 0; i < n; i++) {
        const x = (seed + i * 7) % W;
        const z = (seed + i * 13) % H;
        if (at(x, z).glyph === '·') at(x, z).glyph = e;
      }
    }
  }

  // Drop the wallMounted props on the wall ring (top edge first, then
  // right, etc.). This is just a hint of where they sit — the actual
  // generator scatters them randomly along the room walls.
  const wallSlots = [];
  for (let x = 1; x <= W; x++) wallSlots.push([x - 1, -1]); // N
  for (let z = 1; z <= H; z++) wallSlots.push([W, z - 1]);  // E
  for (let x = W; x >= 1; x--) wallSlots.push([x - 1, H]);  // S
  for (let z = H; z >= 1; z--) wallSlots.push([-1, z - 1]); // W

  let slot = 0;
  for (const w of state.wallMounted) {
    const e = EMOJI[w.type] || '?';
    const n = w.count ?? 1;
    for (let i = 0; i < n; i++) {
      if (slot >= wallSlots.length) break;
      const [x, z] = wallSlots[slot++];
      // Translate to grid coords: outer ring is at (-1) and (W or H).
      const gx = x + 1;
      const gz = z + 1;
      if (cells[gz] && cells[gz][gx]) {
        cells[gz][gx].glyph = e;
        cells[gz][gx].wall = false; // override visual so emoji stands out
      }
    }
  }

  // Render to HTML.
  $previewGrid.style.gridTemplateColumns = `repeat(${totalW}, 28px)`;
  $previewGrid.innerHTML = '';
  for (let z = 0; z < totalH; z++) {
    for (let x = 0; x < totalW; x++) {
      const c = cells[z][x];
      const div = document.createElement('div');
      div.className = 'cell' + (c.wall ? ' wall' : '');
      div.textContent = c.glyph;
      $previewGrid.appendChild(div);
    }
  }
}

/* ── JSON output ─────────────────────────────────────────────── */

function buildThemeObject() {
  const obj = {
    minW: state.minW,
    minH: state.minH,
    placements: state.placements.map((p) => {
      const out = { type: p.type, where: p.where, rot: p.rot };
      if (p.count && p.count > 1) out.count = p.count;
      if (p.where === 'longEnd' && p.offset) out.offset = p.offset;
      return out;
    }),
    wallMounted: state.wallMounted.map((w) => ({
      type: w.type,
      count: w.count ?? 1,
    })),
  };
  return obj;
}

function renderJson() {
  const obj = buildThemeObject();
  const body = JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)":/g, '$1:'); // unquote keys for paste-into-JS
  $jsonOutput.value = `${state.name}: ${body},`;
}

/* ─── Wire DOM events ─────────────────────────────────────────── */

$name.addEventListener('input', () => { state.name = $name.value; render(); });
$minW.addEventListener('input', () => {
  const n = parseInt($minW.value, 10);
  if (!isNaN(n)) { state.minW = Math.max(2, Math.min(10, n)); render(); }
});
$minH.addEventListener('input', () => {
  const n = parseInt($minH.value, 10);
  if (!isNaN(n)) { state.minH = Math.max(2, Math.min(10, n)); render(); }
});

document.getElementById('add-placement').addEventListener('click', () => {
  state.placements.push({
    type: FLOOR_PROPS[0],
    where: 'center',
    rot: 'random',
    count: 1,
  });
  render();
});

document.getElementById('add-wallmounted').addEventListener('click', () => {
  state.wallMounted.push({
    type: WALL_PROPS[0],
    count: 1,
  });
  render();
});

document.getElementById('btn-copy').addEventListener('click', () => {
  $jsonOutput.select();
  navigator.clipboard.writeText($jsonOutput.value).then(
    () => alert('JSON copié dans le presse-papier ✓'),
    () => alert('Échec de la copie — sélectionne le texte manuellement.'),
  );
});

document.getElementById('btn-load').addEventListener('click', () => {
  // Try to parse whatever's in the textarea — accepts either a strict
  // JSON object or the "name: { ... }," paste format the editor exports.
  let raw = $jsonOutput.value.trim();
  // Strip trailing commas + leading "name: " if present.
  raw = raw.replace(/,\s*$/, '');
  const colonIdx = raw.indexOf(':');
  let nameOverride = null;
  if (colonIdx > 0 && raw[0] !== '{') {
    nameOverride = raw.slice(0, colonIdx).trim();
    raw = raw.slice(colonIdx + 1).trim();
  }
  // Quote unquoted keys so JSON.parse works.
  raw = raw.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  // Quote single-quoted strings.
  raw = raw.replace(/'([^']*)'/g, '"$1"');
  try {
    const parsed = JSON.parse(raw);
    if (nameOverride) state.name = nameOverride;
    state.minW = parsed.minW ?? state.minW;
    state.minH = parsed.minH ?? state.minH;
    state.placements = (parsed.placements ?? []).map((p) => ({
      type: p.type,
      where: p.where,
      rot: p.rot ?? 'random',
      count: p.count ?? 1,
      offset: p.offset,
    }));
    state.wallMounted = (parsed.wallMounted ?? []).map((w) => ({
      type: w.type,
      count: w.count ?? 1,
    }));
    render();
    alert('Thème chargé ✓');
  } catch (e) {
    alert('JSON invalide : ' + e.message);
  }
});

render();
