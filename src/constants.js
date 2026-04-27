// Game constants — all numeric values live here so they're easy to tweak.

export const GRID_SIZE = 24;
export const CELL = 2;
export const WALL = 0;
export const FLOOR = 1;
export const STAIRS = 2;
export const MAX_FLOOR = 5;

export const ATTACK_RANGE = 2.4;
export const ATTACK_ARC = Math.PI * 0.55;   // ~100° cone
export const ATTACK_COOLDOWN = 0.45;
export const ATTACK_DURATION = 0.28;

export const DASH_DISTANCE = 4.0;
export const DASH_DURATION = 0.18;
export const DASH_COOLDOWN = 1.0;

export const STATE = {
  MENU: 0,
  PLAYING: 1,
  PAUSED: 2,
  GAME_OVER: 3,
  VICTORY: 4,
};
