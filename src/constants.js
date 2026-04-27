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

// Player classes. Each owns its model, base stats, attack tuning, and the
// names of the glTF clips it should play for each gameplay state. Cleric has
// no Roll clip so it uses Spell1 for the dash anim; otherwise the four share
// roughly the same animation vocabulary.
const PI = Math.PI;
export const CLASSES = {
  warrior: {
    label: 'Guerrier',
    icon: '⚔️',
    desc: 'Équilibré. Épée tranchante, dash agile.',
    model: 'warrior',
    scale: 0.55,
    color: 0x4488dd,
    stats: { hp: 100, atk: 10, spd: 1.0 },
    attack: { range: 2.4, arc: PI * 0.55, cd: 0.45, dur: 0.28 },
    anims: { idle: 'Idle_Weapon', run: 'Run_Weapon', attack: 'Sword_Attack2', dash: 'Roll', death: 'Death' },
  },
  rogue: {
    label: 'Voleur',
    icon: '🗡️',
    desc: 'Rapide, fragile. Frappes vives à la dague.',
    model: 'rogue',
    scale: 0.55,
    color: 0xc04848,
    stats: { hp: 70, atk: 8, spd: 1.4 },
    attack: { range: 2.0, arc: PI * 0.45, cd: 0.30, dur: 0.20 },
    anims: { idle: 'Idle', run: 'Run', attack: 'Dagger_Attack', dash: 'Roll', death: 'Death' },
  },
  wizard: {
    label: 'Mage',
    icon: '🔮',
    desc: 'Puissant mais lent. Coups de bâton chargés.',
    model: 'wizard',
    scale: 0.55,
    color: 0x7744cc,
    stats: { hp: 75, atk: 16, spd: 0.85 },
    attack: { range: 3.2, arc: PI * 0.6, cd: 0.60, dur: 0.35 },
    anims: { idle: 'Idle_Weapon', run: 'Run_Weapon', attack: 'Staff_Attack', dash: 'Roll', death: 'Death' },
  },
  cleric: {
    label: 'Prêtre',
    icon: '✨',
    desc: 'Robuste. Plus de PV, frappes saintes.',
    model: 'cleric',
    scale: 0.55,
    color: 0xeecc44,
    stats: { hp: 140, atk: 9, spd: 0.95 },
    attack: { range: 2.4, arc: PI * 0.55, cd: 0.50, dur: 0.30 },
    anims: { idle: 'Idle_Weapon', run: 'Run', attack: 'Staff_Attack', dash: 'Spell1', death: 'Death' },
  },
};

// Inter-floor boons. Stat-mul / additive modifiers applied via apply().
// Each one runs once when picked from the 3-choice overlay.
export const BOONS = [
  { id: 'maxhp',   icon: '❤️',  label: '+25 PV max',          desc: 'Augmente ta vie maximale (et te soigne).',  apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'atk',     icon: '⚔️', label: '+5 Attaque',           desc: 'Tes coups font plus mal.',                    apply: (p) => { p.atk += 5; } },
  { id: 'spd',     icon: '⚡',  label: '+15% Vitesse',         desc: 'Tu te déplaces plus vite.',                   apply: (p) => { p.spd *= 1.15; } },
  { id: 'cdAtk',   icon: '🌪️', label: '-20% Cooldown attaque', desc: 'Tu peux frapper plus souvent.',               apply: (p) => { p.atkCdMul *= 0.8; } },
  { id: 'cdDash',  icon: '💨', label: '-25% Cooldown dash',   desc: 'Le dash recharge plus vite.',                  apply: (p) => { p.dashCdMul *= 0.75; } },
  { id: 'range',   icon: '🎯', label: '+0.6m Portée',         desc: "L'arc d'attaque touche plus loin.",           apply: (p) => { p.atkRangeAdd += 0.6; } },
  { id: 'arc',     icon: '🌀', label: '+30% Arc',             desc: "L'arc d'attaque est plus large.",             apply: (p) => { p.atkArcMul *= 1.3; } },
  { id: 'heal',    icon: '🍖', label: 'Soin complet',         desc: 'Restaure tes PV à fond.',                     apply: (p) => { p.hp = p.maxHp; } },
];
