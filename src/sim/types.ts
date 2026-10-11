// Internal simulation state. Public consumers see these objects through the core contract types
// (UnitState / HeroState / Buff); the extra fields below are sim-internal but readable (e.g. by the dev scene).
import type { EventBus } from '../core/events';
import type { AbilityContext, Buff, CastTarget, DerivedStats, HeroState, Sim, UnitState } from '../core/sim';
import type { GameEvents, Team, Vec2 } from '../core/types';
import type { UnitExtra } from '../data';

/** How the built-in unit AI drives a unit. */
export type Behaviour =
  /** The human player's hero: moved kinematically, never auto-attacks. */
  | 'player'
  /** Bot hero: executes Order (move / attackMove / attack / hold / cast / idle). */
  | 'hero'
  /** Lane creep: attack-moves along its lane. */
  | 'lane'
  /** Neutral creep / Roshan: guards its home position and leashes back. */
  | 'guard'
  /** Tower / fountain / building: attacks in range, never moves. */
  | 'structure';

/** Buff with sim-internal extras (all optional, all folded by the sim). */
export interface SimBuff extends Buff {
  /** Heal over time (HP per second). */
  hpPerSecond?: number;
  /** Mana over time (per second). */
  manaPerSecond?: number;
  /** Removed when the unit takes damage from another team (Healing Salve, Clarity, Regeneration rune). */
  dispelOnDamage?: boolean;
  /** Removed when the unit attacks or casts (Invisibility rune). */
  breakOnAttack?: boolean;
  /** Fixed movement speed that overrides slows (Haste rune: 522). */
  fixedMoveSpeed?: number;
  /** Removed once HP and mana are both full (Regeneration rune). */
  endWhenFull?: boolean;
  /** Next sim time a dps buff deals its accumulated damage. */
  nextDpsAt?: number;
}

export interface SimHero extends HeroState {
  /** Charges per inventory slot (consumables; 0 for items without charges). */
  itemCharges: number[];
  /** Sim time when buyback is available again. */
  buybackReadyAt: number;
  /** Seconds added to the next respawn (25% of the time skipped by the last buyback). */
  respawnPenalty: number;
  /** Unreliable gold income is blocked until this time (after a buyback). */
  unreliableBlockedUntil: number;
  /** Hero kills since the last death. */
  streak: number;
  /** Current multi-kill count and the time of the last kill. */
  multiKill: number;
  lastKillAt: number;
  /** abilityId → sim time the next charge is restored (charge abilities below max charges). */
  chargeRestoreAt: Record<string, number>;
  /** Aegis expiry time (Infinity when no Aegis). */
  aegisExpiresAt: number;
  /** The pending respawn is an Aegis reincarnation (respawn in place). */
  aegisRevive: boolean;
}

export interface PendingCast {
  abilityId: string;
  level: number;
  target: CastTarget;
  resolveAt: number;
  /** Item slot that holds the item for item actives, else -1. */
  itemSlot: number;
}

export interface SimUnit extends UnitState {
  buffs: SimBuff[];
  hero?: SimHero;
  behaviour: Behaviour;
  extra: UnitExtra | undefined;
  isBuilding: boolean;
  ranged: boolean;
  /** Building protection (tower order, fountain). Separate from invulnerable buffs. */
  baseInvulnerable: boolean;
  /** Lane creep upgrades / Roshan growth. */
  bonusHp: number;
  bonusDamage: number;
  bonusArmor: number;
  /** Scaled true-sight radius (towers, ancients, fountains); 0 = none. */
  trueSight: number;

  // --- combat ---
  /** Current attack target id (0 = none). */
  targetId: number;
  /** Target is locked (creep aggro / tower hero aggro) until this time. */
  forcedUntil: number;
  /** 0 = ready / moving, 1 = windup (before the attack point), 2 = backswing. */
  attackPhase: 0 | 1 | 2;
  phaseEnd: number;
  attackReadyAt: number;
  nextAcquireAt: number;
  chaseTime: number;
  ignoreId: number;
  ignoreUntil: number;

  // --- movement ---
  /** Lane creeps: remaining waypoints (already oriented for the creep's team). */
  lanePath: Vec2[] | null;
  laneIndex: number;
  /** PathFinder result being followed and the goal it was computed for. */
  path: Vec2[] | null;
  pathIndex: number;
  pathGoalX: number;
  pathGoalY: number;
  pathAt: number;
  /** Guard units: home position, returning flag and the out-of-reach timer. */
  home: Vec2 | null;
  returning: boolean;
  leashTimer: number;
  /** Set when the unit moved this tick (animation hint). */
  moved: boolean;

  // --- casting ---
  pendingCast: PendingCast | null;

  // --- bookkeeping ---
  /** Bit per team (sentinel 1, scourge 2, neutral 4) that currently sees this unit. */
  visMask: number;
  /** Last viewer id per team (vision coherence). */
  seenBy: [number, number, number];
  /** Removal time for corpses (Infinity while alive / for heroes). */
  removeAt: number;
  removed: boolean;
  statsCache: DerivedStats | null;
  /** Backdoor protection: no enemy creeps nearby, and the HP cap it can regenerate to. */
  bdProtected: boolean;
  bdCap: number;
  /** Neutral camp index (-1 = none). */
  campIndex: number;
  /** Cached ability contexts (ability id → ctx) for tick/onAttack hooks. */
  ctx: Map<string, AbilityContext> | null;
}

export type RuneKind = 'haste' | 'doubleDamage' | 'illusion' | 'invisibility' | 'regeneration' | 'bounty';

export interface RuneState {
  id: number;
  kind: RuneKind;
  x: number;
  y: number;
  z: number;
  spawnedAt: number;
  /** First rune spawn (bounty runes give the fixed first-spawn reward). */
  first: boolean;
}

export interface ProjectileState {
  id: number;
  sourceId: number;
  targetId: number;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  speed: number;
  visual: string;
  onHit: () => void;
  done: boolean;
}

export interface SimOptions {
  /** Event bus to use (default: a new one). */
  events?: EventBus<GameEvents>;
  /** Start the clock here instead of the 6.83d pre-game (-90 s). Tests and dev scenes use it to skip the wait. */
  startTime?: number;
  /** Spawn neutral camps and Roshan (default true). */
  neutrals?: boolean;
  /** Spawn lane creep waves (default true). */
  waves?: boolean;
}

/** createSim() result: the core Sim contract plus read-only extras for renderers, HUD and tests. */
export interface SimWorld extends Sim {
  /** Projectiles in flight (homing). prev* = last tick for interpolation. */
  projectiles(): readonly ProjectileState[];
  /** Runes currently on the map. */
  runes(): readonly RuneState[];
  /** Winner once an Ancient died, else null. */
  readonly winner: Team | null;
  /** Total gold (reliable + unreliable) of a hero, 0 for non-heroes. */
  gold(unitId: number): number;
  /** Seconds until buyback is off cooldown (0 = ready). */
  buybackCooldown(unitId: number): number;
  /** Current buyback cost for a hero. */
  buybackPrice(unitId: number): number;
  /** Seconds until the next charge of a charge ability is restored (0 = full / none). */
  chargeCooldown(unitId: number, abilityId: string): number;
  /** Removes event listeners (player:shot) — call when tearing down a match. */
  dispose(): void;
}

export const TEAM_BIT: Record<Team, number> = { sentinel: 1, scourge: 2, neutral: 4 };
export const TEAM_INDEX: Record<Team, 0 | 1 | 2> = { sentinel: 0, scourge: 1, neutral: 2 };
export const TEAMS: readonly Team[] = ['sentinel', 'scourge', 'neutral'];
export const enemyTeam = (t: Team): Team => (t === 'sentinel' ? 'scourge' : t === 'scourge' ? 'sentinel' : 'neutral');
