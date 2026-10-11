// Simulation runtime contract (wave 2). Owned by Lead.
// E implements SimApi in src/sim. F (Sniper kit), G (nav + AI) and H (UI) consume it.
// The sim is authoritative for every unit, including the player's hero: the player controller
// drives the hero's position kinematically via setUnitPosition and reads movement limits
// (slows / stuns) back from the sim.
import type { EventBus } from './events';
import type { LoadedMap } from './map';
import type { Rng } from './rng';
import type { AbilityDef, ArmorType, AttackType, DamageType, GameEvents, HeroDef, Lane, Team, Tier, UnitDef, UnitKind, Vec2, Vec3 } from './types';

export type { DamageType };

export interface Buff {
  /** Stable id; re-applying the same id refreshes it (unless stacking is handled by the ability). */
  id: string;
  sourceId: number | null;
  /** Sim time when it ends (Infinity = until removed). */
  expiresAt: number;
  /** Multiplicative movement speed change, e.g. -0.3 = 30% slow. */
  moveSpeedPct?: number;
  /** Additive attack speed (IAS) change, e.g. 0.4 = +40 IAS. */
  attackSpeed?: number;
  /** Additive flat changes. */
  armor?: number;
  damage?: number;
  attackRange?: number;
  /** Multiplicative damage multiplier (e.g. Double Damage rune = 1). */
  damagePct?: number;
  stunned?: boolean;
  silenced?: boolean;
  invisible?: boolean;
  invulnerable?: boolean;
  magicImmune?: boolean;
  /** Damage per second applied by the sim while active. */
  dps?: { amount: number; type: DamageType };
}

export interface HeroState {
  def: HeroDef;
  level: number;
  xp: number;
  skillPoints: number;
  /** abilityId → learned level (0 = not learned). */
  skillLevels: Record<string, number>;
  /** abilityId → sim time when it becomes ready. */
  cooldownReadyAt: Record<string, number>;
  /** abilityId → current charges (charge-based abilities only). */
  charges: Record<string, number>;
  reliableGold: number;
  unreliableGold: number;
  /** 6 inventory slots of item ids. */
  items: Array<string | null>;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  /** Sim time of respawn while dead, otherwise null. */
  respawnAt: number | null;
  /** Aegis of the Immortal held. */
  aegis: boolean;
  /** Controlled by the human player (exactly one hero). */
  isPlayer: boolean;
}

export interface UnitState {
  id: number;
  def: UnitDef;
  team: Team;
  kind: UnitKind;
  /** Feet position (WC3 coords). prevPosition = last tick, for render interpolation. */
  position: Vec3;
  prevPosition: Vec3;
  facing: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  alive: boolean;
  lane?: Lane;
  tier?: Tier;
  /** MapData.entities id for units placed from the map (buildings, fountains, shops). */
  entityId?: number;
  buffs: Buff[];
  /** Current order (AI / creeps). Player hero ignores orders. */
  order: Order;
  /** Animation hint for renderers. */
  anim: 'idle' | 'walk' | 'attack' | 'cast' | 'death';
  hero?: HeroState;
}

/** Derived, buff-inclusive combat stats (computed by the sim). */
export interface DerivedStats {
  damageMin: number;
  damageMax: number;
  armor: number;
  armorType: ArmorType;
  attackType: AttackType;
  /** Seconds between attacks after IAS. */
  attackCooldown: number;
  /** Already multiplied by RANGE_SCALE. */
  attackRange: number;
  moveSpeed: number;
  /** Already multiplied by RANGE_SCALE. */
  vision: number;
  magicResistance: number;
  hpRegen: number;
  manaRegen: number;
}

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'attack'; targetId: number }
  | { type: 'hold' }
  | { type: 'cast'; abilityId: string; targetId?: number; x?: number; y?: number };

export interface CastTarget {
  targetId?: number;
  point?: Vec2;
}

export interface DamageRequest {
  sourceId: number | null;
  targetId: number;
  amount: number;
  type: DamageType;
  /** True for basic attacks (rifle shots, creep/tower attacks): applies attack-type × armor-type and armor. */
  isAttack: boolean;
  attackType?: AttackType;
  /** FPS-only: shot hit the head (Headshot proc is guaranteed). */
  headshot?: boolean;
  abilityId?: string;
}

export interface ProjectileRequest {
  sourceId: number;
  targetId: number;
  /** WC3 units / second. Homing, like WC3 projectiles. */
  speed: number;
  visual: string;
  onHit: (sim: SimApi) => void;
}

/** Context passed to ability implementations. */
export interface AbilityContext {
  sim: SimApi;
  caster: UnitState;
  def: AbilityDef;
  /** Learned level, 1-based. */
  level: number;
  /** Per-level value lookup: value('damage') → number for the current level. */
  value: (key: string) => number;
}

/**
 * Ability effect implementation. The sim handles mana, cooldown, charges, level requirements,
 * cast point and silence/stun checks generically from AbilityDef; impls only apply effects.
 */
export interface AbilityImpl {
  id: string;
  /** Active cast resolved (after cast point). */
  cast?(ctx: AbilityContext, target: CastTarget): void;
  /** Passive: modify an outgoing basic attack before damage (e.g. Headshot). */
  onAttack?(ctx: AbilityContext, req: DamageRequest): void;
  /** Called every sim tick while the ability is learned (auras, charge regen, channels). */
  tick?(ctx: AbilityContext, dt: number): void;
}

/** Implemented by src/nav (G). The sim falls back to straight lines until it's registered. */
export interface PathFinder {
  findPath(from: Vec2, to: Vec2, radius: number): Vec2[] | null;
}

export interface UnitQuery {
  team?: Team;
  /** Exclude this team (e.g. "enemies of sentinel" = notTeam: 'sentinel', plus neutrals). */
  notTeam?: Team;
  kinds?: UnitKind[];
  aliveOnly?: boolean;
  /** Only units visible to this team (fog of war). */
  visibleTo?: Team;
}

export interface SimApi {
  readonly map: LoadedMap;
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  /** Seconds since the horn (negative during pre-game). */
  readonly time: number;
  /** 0..1 day/night phase; isDay derived from it. */
  readonly timeOfDay: number;
  readonly isDay: boolean;

  units(): readonly UnitState[];
  get(id: number): UnitState | undefined;
  query(x: number, y: number, radius: number, q?: UnitQuery): UnitState[];
  stats(unitId: number): DerivedStats;
  isVisibleTo(team: Team, unitId: number): boolean;

  spawn(defId: string, team: Team, x: number, y: number, extra?: { lane?: Lane; tier?: Tier; facing?: number }): UnitState;
  /** The human player's hero. */
  player(): UnitState;

  order(unitId: number, order: Order): void;
  /** Kinematic position update (player controller). Ignored while stunned. */
  setUnitPosition(unitId: number, pos: Vec3, facing: number): void;
  teleport(unitId: number, x: number, y: number): void;

  /** Returns the damage actually dealt after armor/resistances. */
  dealDamage(req: DamageRequest): number;
  heal(unitId: number, amount: number): void;
  restoreMana(unitId: number, amount: number): void;
  addBuff(unitId: number, buff: Buff): void;
  removeBuff(unitId: number, buffId: string): void;
  launchProjectile(req: ProjectileRequest): void;

  /** Validate + start a cast (mana/cooldown/charges/range). Returns false with a reason. */
  castAbility(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string };
  learnAbility(unitId: number, abilityId: string): boolean;
  registerAbility(impl: AbilityImpl): void;
  setPathFinder(pf: PathFinder): void;

  buyItem(unitId: number, itemId: string): { ok: true } | { ok: false; reason: string };
  buyback(unitId: number): boolean;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MatchConfig {
  seed: number;
  /** Player hero def id (always 'sniper' for now), Sentinel side. */
  playerHero: string;
  /** Allied bot hero def ids (0–4), Sentinel. */
  allies: string[];
  /** Enemy bot hero def ids (1–5), Scourge. */
  enemies: string[];
  difficulty: Difficulty;
}

/**
 * The concrete simulation (src/sim, agent E). Charge-based abilities are generic: an AbilityDef with
 * values.charges + values.chargeRestoreTime gets HeroState.charges handled by the sim (e.g. Shrapnel).
 */
export interface Sim extends SimApi {
  readonly config: MatchConfig;
  /** Advance one fixed tick (SIM_DT). */
  step(dt: number): void;
  /** Called by bot controllers (G) — AI brains registered per hero unit id. */
  registerBrain(unitId: number, brain: { update(sim: SimApi, dt: number): void }): void;
}

