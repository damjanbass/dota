// Shared contracts. Owned by Lead — agents request changes via CONTRACT_REQUESTS.md.
// All distances are WC3 units, all times seconds, all angles radians (WC3 axes, see coords.ts).

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Team = 'sentinel' | 'scourge' | 'neutral';
export type Lane = 'top' | 'mid' | 'bot';
export type Tier = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Game data definitions (produced by src/data, consumed by sim/ai/ui)
// ---------------------------------------------------------------------------

/** WC3 attack types. */
export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'chaos' | 'spells' | 'hero';

/** WC3 armor types (in-game names; data files call light/heavy "small"/"large"). */
export type ArmorType = 'unarmored' | 'light' | 'medium' | 'heavy' | 'fortified' | 'hero' | 'divine' | 'normal';

export type UnitKind =
  | 'hero'
  | 'creep_melee'
  | 'creep_ranged'
  | 'creep_siege'
  | 'tower'
  | 'barracks_melee'
  | 'barracks_ranged'
  | 'ancient'
  | 'fountain'
  | 'building'
  | 'neutral'
  | 'roshan'
  | 'summon';

export interface UnitDef {
  id: string; // stable id, e.g. 'sentinel_creep_melee'
  name: string; // display name, e.g. 'Treant'
  kind: UnitKind;
  hp: number;
  hpRegen: number; // per second
  mana: number;
  manaRegen: number; // per second
  armor: number;
  armorType: ArmorType;
  damageMin: number;
  damageMax: number;
  attackType: AttackType;
  /** Unscaled DotA range. Multiply by RANGE_SCALE at runtime (config.scaledRange). 0 = cannot attack. */
  attackRange: number;
  /** Base attack time (seconds between attacks at 0 IAS). */
  attackCooldown: number;
  /** Attack point / windup (seconds). */
  attackPoint: number;
  /** undefined = melee (instant hit at attack point). */
  projectileSpeed?: number;
  moveSpeed: number; // 0 for buildings
  turnRate?: number;
  visionDay: number; // unscaled
  visionNight: number; // unscaled
  collisionRadius: number;
  /** Visual / hitbox height in WC3 units (feet → top of head). */
  height: number;
  bountyGoldMin: number;
  bountyGoldMax: number;
  bountyXp: number;
  /** 0..1, e.g. heroes 0.25 in DotA. */
  magicResistance: number;
  /** Ability ids this unit owns (passives included). */
  abilities: string[];
  /** Free-form source note, e.g. 'w3u e00R + DotA 6.83d changelog'. */
  source: string;
}

export type PrimaryAttribute = 'str' | 'agi' | 'int';

export interface HeroDef extends UnitDef {
  kind: 'hero';
  primary: PrimaryAttribute;
  str: number;
  agi: number;
  int: number;
  strGain: number;
  agiGain: number;
  intGain: number;
  /** Ordered skill slots (4 for most heroes; Sniper: shrapnel, headshot, take_aim, assassinate). */
  skills: string[];
}

export type AbilityKind = 'active' | 'passive' | 'ultimate' | 'item';
export type AbilityTargeting = 'none' | 'point' | 'unit' | 'hero' | 'self';

export interface AbilityDef {
  id: string; // e.g. 'sniper_shrapnel'
  name: string;
  kind: AbilityKind;
  targeting: AbilityTargeting;
  /** FPS hotkey for the player kit (null for AI-only / passive). */
  key: 'Q' | 'E' | 'R' | 'F' | null;
  maxLevel: number;
  /** Hero level required for each ability level (e.g. ult: [6, 11, 16]). */
  requiredLevels: number[];
  /** Per-level arrays (index 0 = level 1). Single-element arrays apply to all levels. */
  cooldown: number[];
  manaCost: number[];
  castRange: number[]; // unscaled; [0] if not applicable
  castPoint: number;
  /** Ability-specific per-level values: damage, radius, duration, slow, chance, charges, ... */
  values: Record<string, number[]>;
  description: string;
  source: string;
}

export interface ItemDef {
  id: string;
  name: string;
  cost: number;
  /** Shop where it's sold. */
  shop: 'base' | 'secret' | 'side';
  /** Passive stat bonuses. */
  stats: Partial<Record<'str' | 'agi' | 'int' | 'damage' | 'armor' | 'attackSpeed' | 'moveSpeed' | 'hp' | 'mana' | 'hpRegen' | 'manaRegen' | 'attackRange', number>>;
  /** Optional active ability id. */
  active?: string;
  components?: string[];
  stackable?: boolean;
  source: string;
}

// ---------------------------------------------------------------------------
// Runtime contracts used across modules in wave 1
// ---------------------------------------------------------------------------

/** Anything the player's hitscan can hit. Positions are feet position in WC3 coords. */
export interface Hittable {
  id: number;
  team: Team;
  position: Vec3;
  bodyRadius: number;
  bodyHeight: number; // body capsule from feet to neck
  headRadius: number; // head sphere sits on top of the body
  alive: boolean;
}

export type HitPart = 'head' | 'body';

export interface ShotResult {
  targetId: number | null;
  part: HitPart | null;
  /** World-space impact point (target, terrain or tree). */
  point: Vec3;
  distance: number;
  /** What stopped the ray when no unit was hit. */
  blockedBy: 'terrain' | 'tree' | 'building' | 'range' | null;
}

/** Cross-module events. Add new events via CONTRACT_REQUESTS.md. */
export interface GameEvents extends Record<string, unknown> {
  'player:shot': { origin: Vec3; direction: Vec3; result: ShotResult };
  'player:ability': { abilityId: string; target?: Vec3; targetId?: number };
  'unit:damaged': { targetId: number; sourceId: number | null; amount: number; headshot: boolean };
  'unit:died': { unitId: number; killerId: number | null };
  'match:ended': { winner: Team };
}
