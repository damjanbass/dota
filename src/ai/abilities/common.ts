// Shared helpers and per-sim state for the enemy hero kits and neutral abilities.
//
// Range convention (CLAUDE.md "Ranges"): cast ranges, travel distances, AoE / aura / bounce radii and
// break distances are DotA ranges and get scaledRange(). Projectile and spell travel SPEEDS are never
// scaled. The hit widths of line skillshots (Meat Hook 125, Impale 150) are collision sizes, not
// ranges: they stay unscaled so the FPS player can actually sidestep them.
import { scaledRange } from '../../core/config';
import type { AbilityContext, Buff, SimApi, UnitState } from '../../core/sim';
import type { UnitKind, Vec2 } from '../../core/types';

export const sr = scaledRange;

const STRUCTURES: ReadonlySet<UnitKind> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);

export const isStructure = (u: UnitState): boolean => STRUCTURES.has(u.kind);
export const hasBuff = (u: UnitState, id: string): boolean => u.buffs.some((b) => b.id === id);
export const isStunned = (u: UnitState): boolean => u.buffs.some((b) => b.stunned);
export const isSilenced = (u: UnitState): boolean => u.buffs.some((b) => b.silenced);
export const isMagicImmune = (u: UnitState): boolean => u.buffs.some((b) => b.magicImmune);
export const isInvulnerable = (u: UnitState): boolean => u.buffs.some((b) => b.invulnerable);
/** Stunned, silenced or hexed: can't start or keep channelling a spell. */
export const isDisabled = (u: UnitState): boolean => !u.alive || isStunned(u) || isSilenced(u);

/** Alive enemy non-structure units a spell can affect around (x, y). */
export const spellTargetsAround = (sim: SimApi, caster: UnitState, x: number, y: number, radius: number, includeStructures = false): UnitState[] =>
  sim
    .query(x, y, radius, { notTeam: caster.team, aliveOnly: true })
    .filter((u) => u.alive && u.team !== caster.team && (includeStructures ? u.kind !== 'fountain' : !isStructure(u)) && !isInvulnerable(u) && !isMagicImmune(u));

/** Unit-target spell validity on an enemy (alive, not magic immune / invulnerable). */
export const canAffect = (t: UnitState | undefined): t is UnitState => !!t && t.alive && !isMagicImmune(t) && !isInvulnerable(t);

export const damageTypeOf = (ctx: AbilityContext): 'magical' | 'physical' | 'pure' => ctx.def.damageType ?? 'magical';

export const dir2 = (from: Vec2, to: Vec2, fallbackAngle: number): Vec2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };
  return { x: dx / d, y: dy / d };
};

/** Frost (WC3 FrostMoveSpeedDecrease / FrostAttackSpeedDecrease) slow; one shared id so frost never stacks. */
export const frostSlow = (sourceId: number, until: number, move: number, attack: number): Buff => ({
  id: 'frost_slow',
  sourceId,
  expiresAt: until,
  moveSpeedPct: -move,
  attackSpeed: -attack,
});

// ---------------------------------------------------------------------------------------------------
// Per-sim kit state

/** A line projectile driven by an ability's tick() (the contract only has homing projectiles). */
export interface Skillshot {
  id: number;
  kind: 'meat_hook' | 'impale' | 'requiem';
  casterId: number;
  abilityId: string;
  /** Current head position. */
  x: number;
  y: number;
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
  /** Distance travelled outward. */
  traveled: number;
  maxDist: number;
  speed: number;
  /** Hit radius around the head (unscaled collision width, see header). */
  radius: number;
  phase: 'out' | 'back';
  /** Units already hit (impale / requiem hit each unit once). */
  hit: Set<number>;
  /** Meat Hook: the unit being dragged back. */
  targetId?: number;
  level: number;
}

export interface Channel {
  abilityId: string;
  targetId: number;
  endsAt: number;
}

export interface KitState {
  nextId: number;
  skillshots: Skillshot[];
  /** casterId → active channel (Dismember, Mana Drain). */
  channels: Map<number, Channel>;
  /** `${unitId}:${abilityId}` → toggle on (Rot) / autocast mode (Poison Attack). */
  toggles: Map<string, boolean>;
  /** `${unitId}:${key}` → numeric stacks (souls, Flesh Heap strength). */
  stacks: Map<string, number>;
  /** casterId → per-raze ready times [near, medium, far]. */
  razeReadyAt: Map<number, [number, number, number]>;
  /** casterId → raze index requested by the bot for its next Shadowraze cast. */
  razeChoice: Map<number, number>;
  /** unitId → time Roshan's Spell Block is ready again. */
  spellBlockReadyAt: Map<number, number>;
  /** Viper: casters whose next attack is a manually cast Poison Attack (mana already paid). */
  poisonPending: Set<number>;
  /** Requiem casts waiting out their cast time. */
  requiemPending: Map<number, { at: number; level: number }>;
  /** Roshan Slam: unitId → ready time (non-hero units have no HeroState cooldowns). */
  slamReadyAt: Map<number, number>;
}

const STATES = new WeakMap<SimApi, KitState>();

export const kitState = (sim: SimApi): KitState => {
  let s = STATES.get(sim);
  if (!s) {
    s = {
      nextId: 1,
      skillshots: [],
      channels: new Map(),
      toggles: new Map(),
      stacks: new Map(),
      razeReadyAt: new Map(),
      razeChoice: new Map(),
      spellBlockReadyAt: new Map(),
      poisonPending: new Set(),
      requiemPending: new Map(),
      slamReadyAt: new Map(),
    };
    STATES.set(sim, s);
  }
  return s;
};

/** Line skillshots currently in flight (for renderers and the dev scene). */
export const activeSkillshots = (sim: SimApi): readonly Skillshot[] => kitState(sim).skillshots;

/** Active channel of a unit, if any. */
export const channelOf = (sim: SimApi, unitId: number): Channel | undefined => {
  const c = kitState(sim).channels.get(unitId);
  return c && c.endsAt > sim.time ? c : undefined;
};

export const isChanneling = (sim: SimApi, unitId: number): boolean => channelOf(sim, unitId) !== undefined;

export const toggleKey = (unitId: number, abilityId: string): string => `${unitId}:${abilityId}`;

export const isToggledOn = (sim: SimApi, unitId: number, abilityId: string): boolean => kitState(sim).toggles.get(toggleKey(unitId, abilityId)) === true;

export const stacksOf = (sim: SimApi, unitId: number, key: string): number => kitState(sim).stacks.get(`${unitId}:${key}`) ?? 0;

export const setStacks = (sim: SimApi, unitId: number, key: string, value: number): void => {
  kitState(sim).stacks.set(`${unitId}:${key}`, value);
};

/**
 * Roshan's Spell Block (ANss, 15 s): blocks one targeted spell. Unit-target spells call this before
 * applying effects; returns true (and consumes the block) when the spell is blocked.
 */
export const consumeSpellBlock = (sim: SimApi, target: UnitState): boolean => {
  if (!target.def.abilities.includes('roshan_spell_block')) return false;
  const s = kitState(sim);
  const ready = s.spellBlockReadyAt.get(target.id) ?? -Infinity;
  if (ready > sim.time) return false;
  s.spellBlockReadyAt.set(target.id, sim.time + 15);
  return true;
};

/** Moves a skillshot head forward by `dist` in sub-steps no longer than half its radius, calling onStep after each. */
export const advanceLine = (shot: Skillshot, dist: number, onStep: (shot: Skillshot) => boolean): void => {
  const step = Math.max(8, shot.radius * 0.5);
  let left = Math.min(dist, shot.maxDist - shot.traveled);
  while (left > 0) {
    const d = Math.min(step, left);
    shot.x += shot.dirX * d;
    shot.y += shot.dirY * d;
    shot.traveled += d;
    left -= d;
    if (onStep(shot)) return;
  }
};

export const newSkillshot = (sim: SimApi, init: Omit<Skillshot, 'id' | 'hit' | 'traveled' | 'phase'>): Skillshot => {
  const s = kitState(sim);
  const shot: Skillshot = { ...init, id: s.nextId++, hit: new Set(), traveled: 0, phase: 'out' };
  s.skillshots.push(shot);
  return shot;
};

export const removeSkillshot = (sim: SimApi, shot: Skillshot): void => {
  const s = kitState(sim);
  const i = s.skillshots.indexOf(shot);
  if (i >= 0) s.skillshots.splice(i, 1);
};
