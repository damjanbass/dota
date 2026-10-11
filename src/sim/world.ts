// The DotA 6.83d simulation: one World instance per match. Deterministic (seeded RNG, fixed tick, ordered
// iteration) and headless (no three.js). Systems live in sibling modules and operate on this class.
import { SIM_DT, scaledRange } from '../core/config';
import { EventBus } from '../core/events';
import { groundHeightAt } from '../core/map';
import type { LoadedMap, MapEntity } from '../core/map';
import { createRng } from '../core/rng';
import type { Rng } from '../core/rng';
import type {
  AbilityContext,
  AbilityImpl,
  Buff,
  CastTarget,
  DamageRequest,
  DerivedStats,
  MatchConfig,
  Order,
  PathFinder,
  ProjectileRequest,
  SimApi,
  UnitQuery,
  UnitState,
} from '../core/sim';
import type { GameEvents, HeroDef, Lane, Team, Tier, UnitDef, UnitKind, Vec3 } from '../core/types';
import { ABILITIES, CREEP_WAVES, DAY_NIGHT, HEROES, UNITS, UNIT_EXTRAS, buybackCost, levelValue } from '../data';
import { castAbility, learnAbility, tickAbilities } from './abilities';
import { initBuildings, onBuildingDestroyed, tickBuildings } from './buildings';
import { applyDamage, onPlayerShot, updateUnitAI } from './combat';
import { passiveGold, rewardUnitKill } from './economy';
import { buybackHero, makeHeroState, onHeroDeath, tickHeroes } from './heroes';
import { separate } from './movement';
import { initNeutrals, onNeutralDeath, tickNeutrals } from './neutrals';
import { tickRunes } from './runes';
import { buyItem } from './shops';
import { SpatialHash } from './spatial';
import { computeStats } from './stats';
import { TUNABLES } from './tunables';
import { TEAM_BIT } from './types';
import type { Behaviour, ProjectileState, RuneState, SimBuff, SimHero, SimOptions, SimUnit, SimWorld } from './types';
import { VisionGrid, recomputeVision } from './vision';
import { initWaves, tickWaves } from './waves';
import type { WaveState } from './waves';
import type { BuildingState } from './buildings';
import type { NeutralState } from './neutrals';
import type { RuneSystemState } from './runes';

export interface Brain {
  update(sim: SimApi, dt: number): void;
}

export interface SpawnInit {
  lane?: Lane;
  tier?: Tier;
  facing?: number;
  entityId?: number;
  behaviour?: Behaviour;
  hero?: SimHero;
  bonusHp?: number;
  bonusDamage?: number;
  /** Emit unit:spawned (default true). */
  silent?: boolean;
}

const STRUCTURE_KINDS: ReadonlySet<UnitKind> = new Set<UnitKind>(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);
const IDLE: Order = Object.freeze({ type: 'idle' }) as Order;
export const IDLE_ORDER = IDLE;

const defaultBehaviour = (kind: UnitKind): Behaviour => {
  if (kind === 'hero' || kind === 'summon') return 'hero';
  if (kind === 'creep_melee' || kind === 'creep_ranged' || kind === 'creep_siege') return 'lane';
  if (kind === 'neutral' || kind === 'roshan') return 'guard';
  return 'structure';
};

const trueSightOf = (def: UnitDef): number => {
  let r = 0;
  for (const id of def.abilities) {
    if (!id.endsWith('true_sight')) continue;
    const a = ABILITIES[id];
    const radius = a?.values.radius?.[0] ?? 0;
    if (radius > r) r = radius;
  }
  return scaledRange(r);
};

const PRE_GAME_HOURS_PER_SECOND = (24 / (DAY_NIGHT.daySeconds + DAY_NIGHT.nightSeconds)) * (DAY_NIGHT.preGameTimeScale / DAY_NIGHT.timeScale);
const HOURS_PER_SECOND = 24 / (DAY_NIGHT.daySeconds + DAY_NIGHT.nightSeconds);

export class World implements SimWorld {
  readonly map: LoadedMap;
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  readonly config: MatchConfig;
  time: number;
  timeOfDay = DAY_NIGHT.startHour / 24;
  isDay = true;
  winner: Team | null = null;

  readonly unitList: SimUnit[] = [];
  readonly byId = new Map<number, SimUnit>();
  readonly heroes: SimUnit[] = [];
  /** Towers + fountains (structures that attack). */
  readonly attackers: SimUnit[] = [];
  readonly impls = new Map<string, AbilityImpl>();
  readonly brains = new Map<number, Brain>();
  pathFinder: PathFinder | null = null;
  readonly projectileList: ProjectileState[] = [];
  readonly runeList: RuneState[] = [];
  readonly hash: SpatialHash;
  readonly vision: VisionGrid;
  /** Team → fountain unit (regen aura). */
  readonly fountains: Partial<Record<Team, SimUnit>> = {};
  /** Team → hero spawn point. */
  readonly heroSpawns: Partial<Record<Team, { x: number; y: number }>> = {};

  waves!: WaveState;
  buildings!: BuildingState;
  neutrals!: NeutralState;
  runeState!: RuneSystemState;
  firstBloodDone = false;

  private playerUnit!: SimUnit;
  private nextUnitId = 1;
  private nextProjectileId = 1;
  private hashDirty = true;
  private nextGoldAt: number;
  private nextVisionAt: number;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(map: LoadedMap, config: MatchConfig, opts: SimOptions = {}) {
    this.map = map;
    this.config = config;
    this.rng = createRng(config.seed);
    this.events = opts.events ?? new EventBus<GameEvents>();
    this.time = opts.startTime ?? -CREEP_WAVES.preGameSeconds;
    this.hash = new SpatialHash(map.data.bounds, 256);
    this.vision = new VisionGrid(map);
    this.updateClock(true);

    this.spawnMapBuildings();
    initBuildings(this);
    this.spawnHeroes();
    initWaves(this, opts.waves !== false);
    initNeutrals(this, opts.neutrals !== false);

    const t = Math.max(this.time, 0);
    this.nextGoldAt = t + 0.6;
    this.nextVisionAt = this.time;
    this.runeState = { nextAt: Math.max(0, Math.ceil(this.time / 120) * 120), lastPower: null, nextRuneId: 1, spawned: 0 };

    this.unsubscribe.push(this.events.on('player:shot', (p) => onPlayerShot(this, p)));
    recomputeVision(this);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private spawnMapBuildings(): void {
    const byWc3 = new Map<string, string>();
    for (const [id, extra] of Object.entries(UNIT_EXTRAS)) if (!byWc3.has(extra.wc3Id)) byWc3.set(extra.wc3Id, id);
    for (const e of this.map.data.entities) {
      const team: Team = e.team;
      const side = team === 'scourge' ? 'scourge' : 'sentinel';
      let defId: string | null = null;
      switch (e.kind) {
        case 'tower':
          defId = `${side}_tower_t${e.tier ?? 1}`;
          break;
        case 'barracks_melee':
        case 'barracks_ranged':
          defId = `${side}_${e.kind}`;
          break;
        case 'ancient':
          defId = `${side}_ancient`;
          break;
        case 'fountain':
          defId = `${side}_fountain`;
          break;
        case 'other': {
          const id = byWc3.get(e.typeId);
          if (id && UNITS[id]?.kind === 'building') defId = id;
          break;
        }
        case 'hero_spawn':
          this.heroSpawns[team] = { x: e.x, y: e.y };
          break;
        default:
          break;
      }
      if (!defId || !UNITS[defId] || team === 'neutral') continue;
      const u = this.spawnUnit(UNITS[defId]!, team, e.x, e.y, { lane: e.lane, tier: e.tier, facing: e.facing, entityId: e.id });
      if (e.kind === 'fountain') this.fountains[team] = u;
      if (u.def.attackRange > 0 && u.def.attackCooldown > 0) this.attackers.push(u);
    }
    for (const team of ['sentinel', 'scourge'] as const) {
      if (!this.heroSpawns[team]) {
        const f = this.fountains[team];
        this.heroSpawns[team] = f ? { x: f.position.x + 200, y: f.position.y + 200 } : { x: 0, y: 0 };
      }
    }
  }

  private spawnHeroes(): void {
    const playerDef = HEROES[this.config.playerHero];
    if (!playerDef) throw new Error(`Unknown player hero ${this.config.playerHero}`);
    this.playerUnit = this.spawnHero(playerDef, 'sentinel', true, 0);
    this.config.allies.forEach((id, i) => this.spawnHero(this.heroDef(id), 'sentinel', false, i + 1));
    this.config.enemies.forEach((id, i) => this.spawnHero(this.heroDef(id), 'scourge', false, i));
  }

  private heroDef(id: string): HeroDef {
    const def = HEROES[id];
    if (!def) throw new Error(`Unknown hero ${id}`);
    return def;
  }

  /** Spawn point for the n-th hero of a team (small ring around the hero spawn). */
  heroSpawnPoint(team: Team, slot: number): { x: number; y: number } {
    const base = this.heroSpawns[team] ?? { x: 0, y: 0 };
    if (slot === 0) return { x: base.x, y: base.y };
    const a = (slot / 6) * Math.PI * 2;
    return { x: base.x + Math.cos(a) * TUNABLES.heroSpawnSpread, y: base.y + Math.sin(a) * TUNABLES.heroSpawnSpread };
  }

  private spawnHero(def: HeroDef, team: Team, isPlayer: boolean, slot: number): SimUnit {
    const p = this.heroSpawnPoint(team, slot);
    return this.spawnUnit(def, team, p.x, p.y, { hero: makeHeroState(def, isPlayer), behaviour: isPlayer ? 'player' : 'hero' });
  }

  spawnUnit(def: UnitDef, team: Team, x: number, y: number, init: SpawnInit = {}): SimUnit {
    const z = groundHeightAt(this.map, x, y);
    const u: SimUnit = {
      id: this.nextUnitId++,
      def,
      team,
      kind: def.kind,
      position: { x, y, z },
      prevPosition: { x, y, z },
      facing: init.facing ?? 0,
      hp: 0,
      maxHp: 0,
      mana: 0,
      maxMana: 0,
      alive: true,
      lane: init.lane,
      tier: init.tier,
      entityId: init.entityId,
      buffs: [],
      order: IDLE,
      anim: 'idle',
      hero: init.hero,
      behaviour: init.behaviour ?? defaultBehaviour(def.kind),
      extra: UNIT_EXTRAS[def.id],
      isBuilding: STRUCTURE_KINDS.has(def.kind),
      ranged: def.projectileSpeed !== undefined,
      baseInvulnerable: false,
      bonusHp: init.bonusHp ?? 0,
      bonusDamage: init.bonusDamage ?? 0,
      bonusArmor: 0,
      trueSight: trueSightOf(def),
      targetId: 0,
      forcedUntil: 0,
      attackPhase: 0,
      phaseEnd: 0,
      attackReadyAt: this.time,
      nextAcquireAt: this.time + ((this.nextUnitId % 9) / 9) * TUNABLES.acquireInterval,
      chaseTime: 0,
      ignoreId: 0,
      ignoreUntil: 0,
      lanePath: null,
      laneIndex: 0,
      path: null,
      pathIndex: 0,
      pathGoalX: 0,
      pathGoalY: 0,
      pathAt: -Infinity,
      home: null,
      returning: false,
      leashTimer: 0,
      moved: false,
      pendingCast: null,
      visMask: TEAM_BIT[team],
      seenBy: [0, 0, 0],
      removeAt: Infinity,
      removed: false,
      statsCache: null,
      bdProtected: false,
      bdCap: 0,
      campIndex: -1,
      ctx: null,
    };
    this.unitStats(u);
    u.hp = u.maxHp;
    u.mana = u.maxMana;
    u.bdCap = u.maxHp;
    this.unitList.push(u);
    this.byId.set(u.id, u);
    if (u.hero) this.heroes.push(u);
    this.hashDirty = true;
    if (!init.silent) this.events.emit('unit:spawned', { unitId: u.id });
    return u;
  }

  // -------------------------------------------------------------------------
  // Unit helpers used by the systems
  // -------------------------------------------------------------------------

  /** Cached derived stats; recomputing keeps the HP / mana fraction when max values change. */
  unitStats(u: SimUnit): DerivedStats {
    if (u.statsCache) return u.statsCache;
    const r = computeStats(u, this.isDay);
    if (r.maxHp !== u.maxHp) {
      if (u.maxHp > 0 && u.alive) u.hp = (u.hp * r.maxHp) / u.maxHp;
      u.maxHp = r.maxHp;
    }
    if (r.maxMana !== u.maxMana) {
      if (u.maxMana > 0 && u.alive) u.mana = (u.mana * r.maxMana) / u.maxMana;
      u.maxMana = r.maxMana;
    }
    u.statsCache = r.stats;
    return r.stats;
  }

  markDirty(u: SimUnit): void {
    u.statsCache = null;
  }

  isInvulnerable(u: SimUnit): boolean {
    if (u.baseInvulnerable) return true;
    for (const b of u.buffs) if (b.invulnerable) return true;
    return false;
  }

  isStunned(u: SimUnit): boolean {
    for (const b of u.buffs) if (b.stunned) return true;
    return false;
  }

  isSilenced(u: SimUnit): boolean {
    for (const b of u.buffs) if (b.silenced) return true;
    return false;
  }

  isMagicImmune(u: SimUnit): boolean {
    for (const b of u.buffs) if (b.magicImmune) return true;
    return false;
  }

  /** Removes buffs that break when the unit attacks or casts (invisibility). */
  breakInvisibility(u: SimUnit): void {
    let changed = false;
    for (let i = u.buffs.length - 1; i >= 0; i--) {
      if (u.buffs[i]!.breakOnAttack) {
        u.buffs.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.markDirty(u);
  }

  /** Appends units near (x, y) into `out` (dead included). */
  queryInto(x: number, y: number, radius: number, out: SimUnit[]): SimUnit[] {
    if (this.hashDirty) {
      this.hash.rebuild(this.unitList);
      this.hashDirty = false;
    }
    return this.hash.queryInto(x, y, radius, out);
  }

  /** Ability context cache (ctx.level is kept current by learnAbility). */
  abilityContext(u: SimUnit, abilityId: string, level: number): AbilityContext | null {
    const def = ABILITIES[abilityId];
    if (!def) return null;
    u.ctx ??= new Map();
    let ctx = u.ctx.get(abilityId);
    if (!ctx) {
      const c: AbilityContext = {
        sim: this,
        caster: u,
        def,
        level,
        value: (key: string) => levelValue(def, key, c.level),
      };
      ctx = c;
      u.ctx.set(abilityId, ctx);
    }
    ctx.level = level;
    return ctx;
  }

  announce(text: string, team: Team | null): void {
    this.events.emit('announce', { text, team });
  }

  /** Every hero of a team (alive or dead). */
  teamHeroes(team: Team): SimUnit[] {
    return this.heroes.filter((h) => h.team === team);
  }

  killUnit(u: SimUnit, killer: SimUnit | null): void {
    if (!u.alive) return;
    if (u.hero?.aegis) {
      // Aegis of the Immortal: reincarnate in place after the revive delay; no bounty, no death.
      u.hero.aegis = false;
      u.hero.aegisExpiresAt = Infinity;
      u.hero.aegisRevive = true;
      this.setDead(u);
      u.hero.respawnAt = this.time + 5;
      this.events.emit('unit:died', { unitId: u.id, killerId: killer?.id ?? null, denied: false });
      this.announce(`${u.def.name} reincarnates with the Aegis of the Immortal`, u.team);
      return;
    }
    const denied = !!killer && killer !== u && killer.team === u.team;
    this.setDead(u);
    this.events.emit('unit:died', { unitId: u.id, killerId: killer?.id ?? null, denied });
    if (u.hero) {
      onHeroDeath(this, u, killer);
      return;
    }
    u.removeAt = this.time + TUNABLES.corpseTime;
    if (u.isBuilding) {
      onBuildingDestroyed(this, u, killer, denied);
      return;
    }
    rewardUnitKill(this, u, killer, denied);
    onNeutralDeath(this, u, killer);
  }

  private setDead(u: SimUnit): void {
    u.alive = false;
    u.hp = 0;
    u.anim = 'death';
    u.attackPhase = 0;
    u.targetId = 0;
    u.pendingCast = null;
    u.path = null;
    u.visMask = 0;
  }

  /** Brings a dead hero back (full HP / mana) at (x, y). */
  reviveHero(u: SimUnit, x: number, y: number): void {
    u.buffs.length = 0;
    u.alive = true;
    u.position.x = x;
    u.position.y = y;
    u.position.z = groundHeightAt(this.map, x, y);
    u.prevPosition.x = x;
    u.prevPosition.y = y;
    u.prevPosition.z = u.position.z;
    u.statsCache = null;
    this.unitStats(u);
    u.hp = u.maxHp;
    u.mana = u.maxMana;
    u.anim = 'idle';
    u.order = IDLE;
    u.visMask = TEAM_BIT[u.team];
    if (u.hero) u.hero.respawnAt = null;
    this.hashDirty = true;
    this.events.emit('unit:spawned', { unitId: u.id });
  }

  launchInternalProjectile(source: SimUnit, target: SimUnit, speed: number, visual: string, onHit: () => void): ProjectileState {
    const launchZ = source.extra?.launchZ ?? 60;
    const p: ProjectileState = {
      id: this.nextProjectileId++,
      sourceId: source.id,
      targetId: target.id,
      x: source.position.x,
      y: source.position.y,
      z: source.position.z + launchZ,
      prevX: source.position.x,
      prevY: source.position.y,
      prevZ: source.position.z + launchZ,
      speed,
      visual,
      onHit,
      done: false,
    };
    this.projectileList.push(p);
    this.events.emit('projectile:launched', { projectileId: p.id, sourceId: source.id, targetId: target.id, visual, speed });
    return p;
  }

  // -------------------------------------------------------------------------
  // SimApi
  // -------------------------------------------------------------------------

  units(): readonly UnitState[] {
    return this.unitList;
  }

  get(id: number): UnitState | undefined {
    return this.byId.get(id);
  }

  query(x: number, y: number, radius: number, q: UnitQuery = {}): UnitState[] {
    const found = this.queryInto(x, y, radius, []);
    const out: UnitState[] = [];
    for (const u of found) {
      if (q.aliveOnly && !u.alive) continue;
      if (q.team !== undefined && u.team !== q.team) continue;
      if (q.notTeam !== undefined && u.team === q.notTeam) continue;
      if (q.kinds && !q.kinds.includes(u.kind)) continue;
      if (q.visibleTo !== undefined && (u.visMask & TEAM_BIT[q.visibleTo]) === 0) continue;
      out.push(u);
    }
    return out;
  }

  stats(unitId: number): DerivedStats {
    const u = this.byId.get(unitId);
    if (!u) throw new Error(`stats(): unknown unit ${unitId}`);
    return this.unitStats(u);
  }

  isVisibleTo(team: Team, unitId: number): boolean {
    const u = this.byId.get(unitId);
    return !!u && u.alive && (u.visMask & TEAM_BIT[team]) !== 0;
  }

  spawn(defId: string, team: Team, x: number, y: number, extra: { lane?: Lane; tier?: Tier; facing?: number } = {}): UnitState {
    const def = UNITS[defId];
    if (!def) throw new Error(`spawn(): unknown unit def ${defId}`);
    const hero = def.kind === 'hero' ? makeHeroState(def as HeroDef, false) : undefined;
    const u = this.spawnUnit(def, team, x, y, { ...extra, hero });
    if (u.behaviour === 'guard') u.home = { x, y };
    if (u.def.attackRange > 0 && u.isBuilding) this.attackers.push(u);
    return u;
  }

  player(): UnitState {
    return this.playerUnit;
  }

  order(unitId: number, order: Order): void {
    const u = this.byId.get(unitId);
    if (!u || u.behaviour === 'player' || u.isBuilding) return;
    if (u.behaviour !== 'hero') {
      u.behaviour = 'hero';
      u.lanePath = null;
    }
    const newTarget = order.type === 'attack' ? order.targetId : 0;
    if (u.attackPhase === 1 && newTarget !== u.targetId) u.attackPhase = 0;
    if (order.type === 'move' && u.attackPhase === 2) u.attackPhase = 0;
    u.order = order;
    u.targetId = newTarget;
    u.path = null;
    u.forcedUntil = 0;
  }

  setUnitPosition(unitId: number, pos: Vec3, facing: number): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive || this.isStunned(u)) return;
    u.position.x = pos.x;
    u.position.y = pos.y;
    u.position.z = pos.z;
    u.facing = facing;
    u.moved = true;
    this.hashDirty = true;
  }

  teleport(unitId: number, x: number, y: number): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    u.position.x = x;
    u.position.y = y;
    u.position.z = groundHeightAt(this.map, x, y);
    u.prevPosition.x = x;
    u.prevPosition.y = y;
    u.prevPosition.z = u.position.z;
    u.path = null;
    this.hashDirty = true;
  }

  dealDamage(req: DamageRequest): number {
    return applyDamage(this, req);
  }

  heal(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive || !(amount > 0)) return;
    u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  restoreMana(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive || !(amount > 0)) return;
    u.mana = Math.min(u.maxMana, u.mana + amount);
  }

  addBuff(unitId: number, buff: Buff): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive) return;
    const b = buff as SimBuff;
    const i = u.buffs.findIndex((x) => x.id === b.id);
    if (i >= 0) u.buffs[i] = b;
    else u.buffs.push(b);
    if (b.stunned) {
      u.attackPhase = 0;
      u.pendingCast = null;
    }
    this.markDirty(u);
  }

  removeBuff(unitId: number, buffId: string): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    const i = u.buffs.findIndex((x) => x.id === buffId);
    if (i < 0) return;
    u.buffs.splice(i, 1);
    this.markDirty(u);
  }

  launchProjectile(req: ProjectileRequest): void {
    const source = this.byId.get(req.sourceId);
    const target = this.byId.get(req.targetId);
    if (!source || !target) return;
    this.launchInternalProjectile(source, target, req.speed, req.visual, () => req.onHit(this));
  }

  castAbility(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string } {
    return castAbility(this, unitId, abilityId, target);
  }

  learnAbility(unitId: number, abilityId: string): boolean {
    return learnAbility(this, unitId, abilityId);
  }

  registerAbility(impl: AbilityImpl): void {
    this.impls.set(impl.id, impl);
  }

  setPathFinder(pf: PathFinder): void {
    this.pathFinder = pf;
    for (const u of this.unitList) u.path = null;
  }

  buyItem(unitId: number, itemId: string): { ok: true } | { ok: false; reason: string } {
    return buyItem(this, unitId, itemId);
  }

  buyback(unitId: number): boolean {
    return buybackHero(this, unitId);
  }

  registerBrain(unitId: number, brain: Brain): void {
    this.brains.set(unitId, brain);
  }

  // --- SimWorld extras -------------------------------------------------------

  projectiles(): readonly ProjectileState[] {
    return this.projectileList;
  }

  runes(): readonly RuneState[] {
    return this.runeList;
  }

  gold(unitId: number): number {
    const h = this.byId.get(unitId)?.hero;
    return h ? h.reliableGold + h.unreliableGold : 0;
  }

  buybackCooldown(unitId: number): number {
    const h = this.byId.get(unitId)?.hero as SimHero | undefined;
    return h ? Math.max(0, h.buybackReadyAt - this.time) : 0;
  }

  buybackPrice(unitId: number): number {
    const h = this.byId.get(unitId)?.hero;
    return h ? buybackCost(h.level, this.time) : 0;
  }

  chargeCooldown(unitId: number, abilityId: string): number {
    const h = this.byId.get(unitId)?.hero as SimHero | undefined;
    const at = h?.chargeRestoreAt[abilityId];
    return at === undefined ? 0 : Math.max(0, at - this.time);
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.brains.clear();
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  step(dt: number = SIM_DT): void {
    if (!(dt > 0)) return;
    const units = this.unitList;
    for (const u of units) {
      u.prevPosition.x = u.position.x;
      u.prevPosition.y = u.position.y;
      u.prevPosition.z = u.position.z;
      if (u.behaviour !== 'player') u.moved = false;
    }
    for (const p of this.projectileList) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.prevZ = p.z;
    }

    this.time += dt;
    this.updateClock(false);
    this.hashDirty = true;

    tickBuildings(this);
    if (this.winner === null) tickWaves(this);
    tickNeutrals(this);
    tickHeroes(this);
    while (this.time >= this.nextGoldAt) {
      passiveGold(this);
      this.nextGoldAt += 0.6;
    }

    for (const [id, brain] of this.brains) {
      if (this.byId.has(id)) brain.update(this, dt);
    }

    this.tickBuffs(dt);
    tickAbilities(this, dt);

    const n = units.length;
    for (let i = 0; i < n; i++) {
      const u = units[i]!;
      if (u.alive) updateUnitAI(this, u, dt);
    }
    separate(this);
    this.tickProjectiles(dt);
    this.tickRegen(dt);
    tickRunes(this);

    if (this.time >= this.nextVisionAt) {
      recomputeVision(this);
      this.nextVisionAt = this.time + TUNABLES.visionInterval;
    }

    this.cleanup();
    this.updateAnims();
    this.hashDirty = true;
  }

  private updateClock(initial: boolean): void {
    const hours = this.time >= 0 ? DAY_NIGHT.startHour + this.time * HOURS_PER_SECOND : DAY_NIGHT.startHour + this.time * PRE_GAME_HOURS_PER_SECOND;
    const hour = ((hours % 24) + 24) % 24;
    this.timeOfDay = hour / 24;
    const day = hour >= DAY_NIGHT.dawnHour && hour < DAY_NIGHT.duskHour;
    if (day !== this.isDay || initial) {
      this.isDay = day;
      for (const u of this.unitList) u.statsCache = null;
    }
  }

  private tickBuffs(dt: number): void {
    const t = this.time;
    for (const u of this.unitList) {
      if (!u.alive || u.buffs.length === 0) continue;
      let changed = false;
      for (let i = u.buffs.length - 1; i >= 0; i--) {
        const b = u.buffs[i]!;
        if (b.expiresAt <= t) {
          u.buffs.splice(i, 1);
          changed = true;
          continue;
        }
        if (b.dps && b.dps.amount > 0) {
          b.nextDpsAt ??= t - dt + TUNABLES.dpsTickInterval;
          if (t >= b.nextDpsAt) {
            b.nextDpsAt += TUNABLES.dpsTickInterval;
            applyDamage(this, { sourceId: b.sourceId, targetId: u.id, amount: b.dps.amount * TUNABLES.dpsTickInterval, type: b.dps.type, isAttack: false });
            if (!u.alive) break;
          }
        }
      }
      if (changed) this.markDirty(u);
    }
  }

  private tickProjectiles(dt: number): void {
    const list = this.projectileList;
    for (const p of list) {
      if (p.done) continue;
      const target = this.byId.get(p.targetId);
      if (!target) {
        p.done = true;
        continue;
      }
      const tz = target.position.z + (target.extra?.impactZ ?? 60);
      const dx = target.position.x - p.x;
      const dy = target.position.y - p.y;
      const dz = tz - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const step = p.speed * dt;
      if (d <= step + 1) {
        p.x = target.position.x;
        p.y = target.position.y;
        p.z = tz;
        p.done = true;
        if (target.alive) {
          p.onHit();
          this.events.emit('projectile:hit', { projectileId: p.id, targetId: p.targetId });
        }
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.z += (dz / d) * step;
    }
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      if (!p.done) list[w++] = p;
    }
    list.length = w;
  }

  private tickRegen(dt: number): void {
    for (const u of this.unitList) {
      if (!u.alive) continue;
      const st = this.unitStats(u);
      let hp = st.hpRegen;
      let mana = st.manaRegen;
      let endWhenFull = false;
      for (const b of u.buffs) {
        if (b.hpPerSecond) hp += b.hpPerSecond;
        if (b.manaPerSecond) mana += b.manaPerSecond;
        if (b.endWhenFull) endWhenFull = true;
      }
      const f = this.fountains[u.team];
      if (f && f !== u && !u.isBuilding) {
        const aura = ABILITIES.fountain_regen_aura;
        if (aura) {
          const r = scaledRange(aura.values.radius![0]!);
          const dx = u.position.x - f.position.x;
          const dy = u.position.y - f.position.y;
          if (dx * dx + dy * dy <= r * r) {
            hp += u.maxHp * aura.values.hpPctPerSecond![0]!;
            mana += u.maxMana * aura.values.manaPctPerSecond![0]! + aura.values.manaFlatPerSecond![0]!;
          }
        }
      }
      if (u.isBuilding && u.bdProtected) {
        // Backdoor protection regen (90 HP/s) never heals above the protected cap.
        const cap = Math.min(u.maxHp, u.bdCap);
        if (u.hp < cap) u.hp = Math.min(cap, u.hp + this.buildings.backdoorRegen * dt);
      }
      if (hp > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + hp * dt);
      if (mana > 0 && u.mana < u.maxMana) u.mana = Math.min(u.maxMana, u.mana + mana * dt);
      if (endWhenFull && u.hp >= u.maxHp && u.mana >= u.maxMana) {
        for (let i = u.buffs.length - 1; i >= 0; i--) if (u.buffs[i]!.endWhenFull) u.buffs.splice(i, 1);
        this.markDirty(u);
      }
    }
  }

  private cleanup(): void {
    const list = this.unitList;
    let removed = false;
    for (const u of list) {
      if (!u.alive && u.removeAt <= this.time) {
        u.removed = true;
        removed = true;
      }
    }
    if (!removed) return;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const u = list[i]!;
      if (u.removed) {
        this.byId.delete(u.id);
        this.brains.delete(u.id);
        continue;
      }
      list[w++] = u;
    }
    list.length = w;
    this.hashDirty = true;
  }

  private updateAnims(): void {
    for (const u of this.unitList) {
      if (!u.alive) {
        u.anim = 'death';
        continue;
      }
      if (u.behaviour === 'player') {
        const dx = u.position.x - u.prevPosition.x;
        const dy = u.position.y - u.prevPosition.y;
        u.anim = dx * dx + dy * dy > 0.01 ? 'walk' : 'idle';
        u.moved = false;
        continue;
      }
      u.anim = u.pendingCast ? 'cast' : u.attackPhase !== 0 ? 'attack' : u.moved ? 'walk' : 'idle';
    }
  }

  /** Entity of the map by id (for buildings). */
  entity(id: number | undefined): MapEntity | undefined {
    return id === undefined ? undefined : this.map.data.entities.find((e) => e.id === id);
  }
}

export const createWorld = (map: LoadedMap, config: MatchConfig, opts?: SimOptions): World => new World(map, config, opts);
