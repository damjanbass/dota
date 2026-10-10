// Sniper (Kardel Sharpeye) — DotA Allstars v6.83d.
// Source: 6.83d map object data (UnitBalance/UnitWeapons/UnitData/UnitUI.slk row 'Usyl',
// AbilityData.slk + *AbilityStrings.txt) and the map script (war3map.j). Hero stat fields hold
// LEVEL-1 values including attribute bonuses; use heroStatsAtLevel() for other levels.
import type { AbilityDef, HeroDef } from '../core/types';
import type { UnitExtra } from './extra';

const OBJ = '6.83d map Usyl (UnitBalance/UnitWeapons/UnitData.slk)';

export const SNIPER: HeroDef = {
  id: 'sniper',
  name: 'Sniper',
  kind: 'hero',
  primary: 'agi',
  str: 16,
  agi: 21,
  int: 15,
  strGain: 1.7,
  agiGain: 2.9,
  intGain: 2.6,
  // 150 base + 16 str * 19
  hp: 454,
  // 0.25 base + 16 str * 0.03
  hpRegen: 0.73,
  // 0 base + 15 int * 13
  mana: 195,
  // 0.01 base + 15 int * 0.04
  manaRegen: 0.61,
  // def 0 + AgiDefenseBase -1 + 21 agi * 0.14
  armor: 1.94,
  armorType: 'hero',
  // dmgplus 13 + 2d4 (15-21) + 21 primary agi
  damageMin: 36,
  damageMax: 42,
  attackType: 'hero',
  attackRange: 550,
  attackCooldown: 1.7,
  attackPoint: 0.17,
  projectileSpeed: 3000,
  moveSpeed: 290,
  turnRate: 0.6,
  visionDay: 1800,
  visionNight: 1000,
  collisionRadius: 24,
  height: 100,
  // Hero bounties are formula-based (tables.ts GOLD / HERO_KILL_XP); these are the level-1 values.
  bountyGoldMin: 209,
  bountyGoldMax: 209,
  bountyXp: 100,
  magicResistance: 0.25,
  abilities: ['sniper_shrapnel', 'sniper_headshot', 'sniper_take_aim', 'sniper_assassinate'],
  skills: ['sniper_shrapnel', 'sniper_headshot', 'sniper_take_aim', 'sniper_assassinate'],
  source:
    `${OBJ}: STR 16+1.7, AGI 21+2.9, INT 15+2.6, HP 150, regenHP 0.25, regenMana 0.01, def 0, dmgplus1 13 dice 2d4, ` +
    'cool1 1.7, dmgpt1 0.17, backSw1 0.7, rangeN1 550, Missilespeed 3000, spd 290, sight 1800/1000, collision 24, turnRate 0.6; ' +
    'attribute math per tables.ts ATTRIBUTES (war3mapMisc.txt). Height is an estimate (VERIFY).',
};

export const SNIPER_EXTRA: UnitExtra = {
  wc3Id: 'Usyl',
  attackBackswing: 0.7,
  acquireRange: 950,
  castPoint: 0.3,
  castBackswing: 0.51,
  modelScale: 1.1,
  launchZ: 60,
  impactZ: 60,
  moveType: 'foot',
};

export const SNIPER_SHRAPNEL: AbilityDef = {
  id: 'sniper_shrapnel',
  name: 'Shrapnel',
  kind: 'active',
  targeting: 'point',
  key: 'Q',
  maxLevel: 4,
  requiredLevels: [1, 3, 5, 7],
  // Charge abilities have no cooldown; charges restore one at a time.
  cooldown: [0],
  manaCost: [50],
  castRange: [1800],
  castPoint: 0.3,
  values: {
    charges: [3],
    chargeRestoreTime: [40],
    radius: [450],
    /** Script enumerates radius + 25. */
    radiusFudge: [25],
    damagePerSecond: [12, 24, 36, 48],
    tickInterval: [1],
    /** 10 damage ticks: first at 0.8 s after cast, last at 9.8 s. */
    ticks: [10],
    firstTickDelay: [0.8],
    duration: [10],
    moveSlow: [0.15, 0.2, 0.25, 0.3],
    /** Slow debuff duration, refreshed by every tick while inside. */
    slowDuration: [2],
    /** The same unit takes at most one Shrapnel tick per 1.1 s (overlapping Shrapnels don't stack). */
    sameTargetLockout: [1.1],
    /** Structures are excluded from the damage enumeration. */
    buildingDamagePct: [0],
    /** Area vision granted to the caster's team. */
    visionDuration: [9.4],
    visionRadius: [360],
  },
  description:
    'Fires shrapnel at a target area. Enemies inside take damage every second and are slowed. Uses charges (3 max, one restored every 40 s).',
  source:
    '6.83d map: A2ZO (learned skill, Researchubertip "12/24/36/48 DPS, 15-30% slow, 10 s, 40 s charge replenish, 3 charges, 50 mana"); ' +
    'A2ZP/A064/A2ZQ/A2ZR charge abilities (AHbz, Rng 1800, Area 450, Cost 50, no cooldown); A19F slow (Aslo 0.15-0.3, Dur 2); ' +
    'war3map.j NT3/NS3/NN3/NM3 (0.4 s + 0.4 s delay, 1 s ticks x10, radius 450+25, damage level*12, 1.1 s lockout, structures excluded), NP3/NU3 (3 charges, 40 s)',
};

export const SNIPER_HEADSHOT: AbilityDef = {
  id: 'sniper_headshot',
  name: 'Headshot',
  kind: 'passive',
  targeting: 'none',
  key: null,
  maxLevel: 4,
  requiredLevels: [1, 3, 5, 7],
  cooldown: [0],
  manaCost: [0],
  castRange: [0],
  castPoint: 0,
  values: {
    chance: [0.4],
    bonusDamage: [15, 40, 65, 90],
    slowDuration: [0.5],
    moveSlow: [1.0],
  },
  description:
    '40% chance on attack to deal bonus physical damage and slow the target by 100% for 0.5 s. In this FPS a real headshot always procs it. Does not proc on buildings.',
  source:
    '6.83d map: A03S (AHbh DataA 40, Ubertip "15/40/65/90 bonus damage, slows by 100% for 0.5 seconds"); ' +
    'war3map.j S53 (GetRandomReal<40, non-structure), S33 (damage 25*level-10 as ATTACK_TYPE_HERO physical, 0.5 s slow via A2YK/A2YL)',
};

export const SNIPER_TAKE_AIM: AbilityDef = {
  id: 'sniper_take_aim',
  name: 'Take Aim',
  kind: 'passive',
  targeting: 'none',
  // Passive in 6.83d; the FPS maps it to the scope key.
  key: 'E',
  maxLevel: 4,
  requiredLevels: [1, 3, 5, 7],
  cooldown: [0],
  manaCost: [0],
  castRange: [0],
  castPoint: 0,
  values: {
    bonusAttackRange: [100, 200, 300, 400],
  },
  description: 'Passively increases attack range by 100/200/300/400.',
  source: '6.83d map: A03U Ubertip "+100/200/300/400 range"; UpgradeData.slk R005 (ratr base 100, mod 100, maxlevel 4); war3map.j NL3 sets R005 = skill level',
};

export const SNIPER_ASSASSINATE: AbilityDef = {
  id: 'sniper_assassinate',
  name: 'Assassinate',
  kind: 'ultimate',
  targeting: 'unit',
  key: 'R',
  maxLevel: 3,
  requiredLevels: [6, 11, 16],
  cooldown: [20, 15, 10],
  manaCost: [175, 275, 375],
  castRange: [2000, 2500, 3000],
  castPoint: 0.3,
  values: {
    damage: [355, 505, 655],
    /** WC3 casting time: the "draw a bead" aim before the shot leaves. */
    aimTime: [1.7, 1.65, 1.5],
    projectileSpeed: [2500],
    ministun: [0.01],
    scepterCastRange: [2500, 3000, 3500],
    scepterAimTime: [0.01],
  },
  description: 'After aiming for 1.7/1.65/1.5 s, fires a homing bullet that deals heavy magic damage at long range and mini-stuns (interrupts channels).',
  source:
    '6.83d map: A04P (AHtb: Cast 1.7/1.65/1.5, Cool 20/15/10, Cost 175/275/375, Rng 2000/2500/3000, DataA 355/505/655, Dur 0.01, Missilespeed 2500); ' +
    'A1AU Aghanim upgrade (Rng 2500/3000/3500, Cast 0.01); hero castpt 0.3',
};

/** Town Portal Scroll active (the item is 'tpscroll' in items.ts). */
export const ITEM_TPSCROLL_ABILITY: AbilityDef = {
  id: 'item_tpscroll',
  name: 'Town Portal',
  kind: 'item',
  targeting: 'point',
  key: 'F',
  maxLevel: 1,
  requiredLevels: [1],
  cooldown: [65],
  manaCost: [75],
  // Global: any allied structure; the fountain if the default location is chosen.
  castRange: [0],
  castPoint: 0,
  values: {
    channelTime: [3],
    /** If other TPs already target the same spot: 4.5 + 0.5 per concurrent TP. */
    stackedChannelBase: [4.5],
    stackedChannelPerTp: [0.5],
    /** You land at most this far from the targeted allied structure (and at least 120 away). */
    landingMaxDistance: [575],
    globalRange: [1],
    goldCost: [100],
  },
  description: 'Channel 3 s, then teleport next to the targeted allied structure. Interrupted by stuns/move orders.',
  source:
    '6.83d map: item I05I (cost 100, uses 1, cooldownID A0CX), ability A1R5 (Cool 65, Cost 75 mana, Rng 99999); A0CX (AHmt DataB 3 = casting delay); ' +
    'war3map.j Y1O (YOO=3, 4.5+0.5*n when stacked), MS0=575 landing radius. castPoint 0 is unverified (VERIFY).',
};

export const SNIPER_ABILITIES: readonly AbilityDef[] = [
  SNIPER_SHRAPNEL,
  SNIPER_HEADSHOT,
  SNIPER_TAKE_AIM,
  SNIPER_ASSASSINATE,
  ITEM_TPSCROLL_ABILITY,
];
