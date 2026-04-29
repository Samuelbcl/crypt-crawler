// Hand-designed room themes. Each theme is a recipe describing what
// props to put inside a room of a given size. The recipe is interpreted
// by placeTheme() in dungeon.js.
//
// Placement vocabulary:
//   center       — exactly at the room centre cell
//   centerLine   — along the central axis of the room (useful for carpets)
//   longEnd      — offset from centre along the room's long axis
//                  (`offset` cells; clamped to the room bounds). Useful
//                  for placing a centrepiece without overlapping a fixed
//                  centre object like the stairs.
//   corners      — the four interior corner floor cells
//   wallMounted  — on a random room-facing wall edge (banners, torches,
//                  windows). `count` controls how many are placed.
//   scattered    — randomly anywhere inside the room.
//
// Rotations:
//   align       — snap to a cardinal axis (good for carpets)
//   random      — random Y rotation
//   none        — keep the model's default
//
// Each prop name must exist in DUNGEON_MODULES (assets.js).

import { rng } from './utils/rng.js';

const T = {
  /* ── Stairs Throne — the room that owns the descending staircase.
     The stairs are auto-placed at room.cx, room.cz, so we offset the
     statue 2 cells along the long axis so it doesn't clip the stairs.
     No carpet (would overlap the stairs cell). Brightly lit. */
  stairs_throne: {
    minW: 4, minH: 4,
    placements: [
      { type: 'Statue_Stag',     where: 'longEnd', offset: 2, rot: 'random' },
      { type: 'Candelabrum_tall',where: 'corners',           rot: 'random' },
    ],
    wallMounted: [
      { type: 'Flag_Wall',  count: 2 },
      { type: 'Flag_Wall2', count: 1 },
      { type: 'Torch_wall', count: 4 },
    ],
  },

  /* ── Throne Room ─────────────────────────────────────────────
     Centerpiece: stag statue with a long carpet leading to it.
     Lavish: many banners, torches at every corner of the walls. */
  throne_room: {
    minW: 5, minH: 4,
    placements: [
      { type: 'Statue_Stag',     where: 'center',     rot: 'random' },
      { type: 'Carpet',          where: 'centerLine', rot: 'align'  },
      { type: 'Candelabrum_tall',where: 'corners',    rot: 'random' },
    ],
    wallMounted: [
      { type: 'Flag_Wall',  count: 2 },
      { type: 'Flag_Wall2', count: 1 },
      { type: 'Torch_wall', count: 3 },
    ],
  },

  /* ── Library — bookcases against walls, candelabra in middle. */
  library: {
    minW: 4, minH: 4,
    placements: [
      { type: 'Candelabrum',     where: 'center',     rot: 'random' },
      { type: 'Bookcase_Full',   where: 'corners',    rot: 'cornerOut', count: 3 },
      { type: 'Bookcase_Empty',  where: 'corners',    rot: 'cornerOut', count: 1 },
    ],
    wallMounted: [
      { type: 'Torch_wall', count: 3 },
      { type: 'Window_Open', count: 1 },
    ],
  },

  /* ── Chapel — sacred space, lots of candles, banners and a centrepiece. */
  chapel: {
    minW: 4, minH: 4,
    placements: [
      { type: 'Candelabrum_tall',where: 'corners',    rot: 'random', count: 4 },
      { type: 'Carpet',          where: 'centerLine', rot: 'align'  },
      { type: 'Statue_Fox',      where: 'center',     rot: 'random' },
    ],
    wallMounted: [
      { type: 'Flag_Wall2', count: 3 },
      { type: 'Torch_wall', count: 2 },
    ],
  },

  /* ── Crypt — death and dust. Bones, skulls, broken pots. */
  crypt: {
    minW: 3, minH: 3,
    placements: [
      { type: 'Bones',     where: 'scattered', rot: 'random', count: 2 },
      { type: 'Skull',     where: 'scattered', rot: 'random', count: 2 },
      { type: 'Pot1',      where: 'scattered', rot: 'random', count: 1 },
      { type: 'Pot3',      where: 'scattered', rot: 'random', count: 1 },
      { type: 'Candles_1', where: 'scattered', rot: 'random', count: 1 },
    ],
    wallMounted: [
      { type: 'Torch_wall', count: 2 },
    ],
  },

  /* ── Treasure room — chests + crates + barrels. The reward room. */
  treasure_room: {
    minW: 3, minH: 3,
    placements: [
      { type: 'Chest',  where: 'center',    rot: 'random' },
      { type: 'Barrel', where: 'scattered', rot: 'random', count: 2 },
      { type: 'Crate',  where: 'scattered', rot: 'random', count: 2 },
      { type: 'Pot2',   where: 'scattered', rot: 'random', count: 1 },
    ],
    wallMounted: [
      { type: 'Torch_wall', count: 2 },
      { type: 'Flag_Wall',  count: 1 },
    ],
  },

  /* ── Prison — grim, sparse, atmospheric. */
  prison: {
    minW: 3, minH: 3,
    placements: [
      { type: 'Bones',     where: 'scattered', rot: 'random', count: 1 },
      { type: 'Skull',     where: 'scattered', rot: 'random', count: 1 },
      { type: 'Crate',     where: 'scattered', rot: 'random', count: 1 },
    ],
    wallMounted: [
      { type: 'Torch_wall', count: 1 },
    ],
  },

  /* ── Empty — the breathing room, minimal decoration so the dungeon
        doesn't feel uniformly cluttered. Used for the start room and
        sometimes elsewhere. */
  empty: {
    minW: 2, minH: 2,
    placements: [],
    wallMounted: [
      { type: 'Torch_wall', count: 1 },
    ],
  },
};

// Themes that can be picked at random for non-special rooms.
const RANDOM_POOL = ['throne_room', 'library', 'chapel', 'crypt', 'treasure_room', 'prison'];

export function getTheme(name) {
  return T[name] || T.empty;
}

// Picks a theme suited to the given room size. Falls back to "empty" if
// nothing fits — keeps the generator robust on small odd rooms.
export function pickRandomTheme(room) {
  const candidates = RANDOM_POOL.filter((key) => {
    const t = T[key];
    return room.w >= t.minW && room.h >= t.minH;
  });
  if (candidates.length === 0) return 'empty';
  return candidates[Math.floor(rng() * candidates.length)];
}
