// Minimal stand-in for agent E's sim (src/sim), implementing only the SimApi/Sim parts the AI and the
// ability impls use. Deterministic (seeded rng), 30 Hz friendly. Good enough for unit tests and the AI
// dev scene: orders with path following, basic attacks (melee instant, ranged homing projectiles), casts
// with cast point / mana / cooldown, buffs (stun, silence, slows, dps), hero XP/levels/gold, simple
// creep/tower auto-acquire and optional mid/top/bot creep waves. Not a balance reference.
import { scaledRange, SIM_DT } from '../../core/config';
import { EventBus } from '../../core/events';
import { entitiesOfKind, type LoadedMap } from '../../core/map';
import { createRng, type Rng } from '../../core/rng';
import type {
  AbilityContext,
  AbilityImpl,
  Buff,
  CastTarget,
  DamageRequest,
  DerivedStats,
  HeroState,
  MatchConfig,
  Order,
  PathFinder,
  ProjectileRequest,
  Sim,
  SimApi,
  UnitQuery,
  UnitState,
} from '../../core/sim';
import type { AbilityDef, GameEvents, HeroDef, Lane, Team, Tier, UnitDef, Vec2, Vec3 } from '../../core/types';
import {
  ABILITIES,
  armorMultiplier,
  attackTypeMultiplier,
  GOLD,
  HEROES,
  heroKillGold,
  heroLevelFromXp,
  heroStatsAtLevel,
  ITEMS,
  levelValue,
  respawnTime,
  UNITS,
} from '../../data';

interface Brain {
  update(sim: SimApi, dt: number): void;
}

interface Runtime {
  attackReadyAt: number;
  /** Basic attack in its windup: resolves at `at`. */
  swing: { targetId: number; at: number } | null;
  pendingCast: { abilityId: string; target: CastTarget; at: number } | null;
  path: Vec2[] | null;
  pathGoal: Vec2 | null;
  pathAt: number;
  /** Lane waypoints still to walk (creeps). */
  laneRoute: Vec2[] | null;
  removeAt: number;
}

interface Projectile {
  id: number;
  sourceId: number;
  targetId: number;
  x: number;
  y: number;
  speed: number;
  onHit: (sim: SimApi) => void;
}

const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export interface FakeSimOptions {
  seed?: number;
  config?: Partial<MatchConfig>;
  /** Spawn lane creep waves every 30 s on these lanes (default none). */
  waves?: Lane[];
  /** Spawn every tower of the map (default false). */
  towers?: boolean;
  /** Seconds since the horn at start (default 0). */
  startTime?: number;
}

export class FakeSim implements Sim {
  readonly map: LoadedMap;
  readonly events = new EventBus<GameEvents>();
  readonly rng: Rng;
  readonly config: MatchConfig;
  time: number;
  timeOfDay = 0.5;
  isDay = true;
  /** Calls to castAbility, for tests. */
  readonly castLog: Array<{ unitId: number; abilityId: string; target: CastTarget; time: number; ok: boolean }> = [];
  pathFinder: PathFinder | null = null;
  readonly abilities = new Map<string, AbilityImpl>();
  private readonly list: UnitState[] = [];
  private readonly byId = new Map<number, UnitState>();
  private readonly rt = new Map<number, Runtime>();
  private readonly brains = new Map<number, Brain>();
  private projectiles: Projectile[] = [];
  private nextId = 1;
  private nextProjectile = 1;
  private visible: Record<Team, Set<number>> = { sentinel: new Set(), scourge: new Set(), neutral: new Set() };
  private readonly waveLanes: Lane[];
  private nextWaveAt = 0;
  private passiveGoldAcc = 0;

  constructor(map: LoadedMap, opts: FakeSimOptions = {}) {
    this.map = map;
    this.rng = createRng(opts.seed ?? 1);
    this.time = opts.startTime ?? 0;
    this.config = { seed: opts.seed ?? 1, playerHero: 'sniper', allies: [], enemies: [], difficulty: 'medium', ...opts.config };
    this.waveLanes = opts.waves ?? [];
    this.nextWaveAt = Math.max(0, this.time);
    if (opts.towers) {
      for (const e of entitiesOfKind(map, 'tower')) {
        const team = e.team === 'scourge' ? 'scourge' : 'sentinel';
        const u = this.spawn(`${team}_tower_t${e.tier ?? 1}`, team, e.x, e.y, { tier: e.tier as Tier, ...(e.lane ? { lane: e.lane } : {}) });
        u.entityId = e.id;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Queries

  units(): readonly UnitState[] {
    return this.list;
  }

  get(id: number): UnitState | undefined {
    return this.byId.get(id);
  }

  query(x: number, y: number, radius: number, q: UnitQuery = {}): UnitState[] {
    const r2 = radius * radius;
    const out: UnitState[] = [];
    const aliveOnly = q.aliveOnly ?? true;
    for (const u of this.list) {
      if (aliveOnly && !u.alive) continue;
      if (q.team && u.team !== q.team) continue;
      if (q.notTeam && u.team === q.notTeam) continue;
      if (q.kinds && !q.kinds.includes(u.kind)) continue;
      if (q.visibleTo && !this.isVisibleTo(q.visibleTo, u.id)) continue;
      if ((u.position.x - x) ** 2 + (u.position.y - y) ** 2 <= r2) out.push(u);
    }
    return out;
  }

  isVisibleTo(team: Team, unitId: number): boolean {
    const u = this.byId.get(unitId);
    if (!u) return false;
    if (u.team === team) return true;
    return this.visible[team].has(unitId);
  }

  stats(unitId: number): DerivedStats {
    const u = this.byId.get(unitId);
    if (!u) throw new Error(`no unit ${unitId}`);
    const def = u.def;
    let damageMin = def.damageMin;
    let damageMax = def.damageMax;
    let armor = def.armor;
    let ias = 0;
    let hpRegen = def.hpRegen;
    let manaRegen = def.manaRegen;
    let moveFlat = 0;
    let rangeAdd = 0;
    if (u.hero) {
      const bonus = { str: 0, agi: 0, int: 0 };
      for (const id of u.hero.items) {
        const it = id ? ITEMS[id] : undefined;
        if (!it) continue;
        bonus.str += it.stats.str ?? 0;
        bonus.agi += it.stats.agi ?? 0;
        bonus.int += it.stats.int ?? 0;
        damageMin += it.stats.damage ?? 0;
        damageMax += it.stats.damage ?? 0;
        armor += it.stats.armor ?? 0;
        ias += it.stats.attackSpeed ?? 0;
        moveFlat = Math.max(moveFlat, it.stats.moveSpeed ?? 0);
        hpRegen += it.stats.hpRegen ?? 0;
      }
      const hs = heroStatsAtLevel(def as HeroDef, u.hero.level, bonus);
      damageMin += hs.damageMin - def.damageMin;
      damageMax += hs.damageMax - def.damageMax;
      armor += hs.armor - def.armor;
      ias += hs.attackSpeedBonus;
      hpRegen += hs.hpRegen - def.hpRegen;
      manaRegen += hs.manaRegen - def.manaRegen;
    }
    let movePct = 1;
    let damagePct = 0;
    for (const b of u.buffs) {
      damageMin += b.damage ?? 0;
      damageMax += b.damage ?? 0;
      armor += b.armor ?? 0;
      ias += b.attackSpeed ?? 0;
      rangeAdd += b.attackRange ?? 0;
      if (b.moveSpeedPct) movePct *= 1 + b.moveSpeedPct;
      damagePct += b.damagePct ?? 0;
    }
    const mult = Math.max(0, 1 + damagePct);
    const moveSpeed = def.moveSpeed === 0 ? 0 : Math.min(522, Math.max(100, (def.moveSpeed + moveFlat) * movePct));
    return {
      damageMin: damageMin * mult,
      damageMax: damageMax * mult,
      armor,
      armorType: def.armorType,
      attackType: def.attackType,
      attackCooldown: def.attackCooldown / Math.max(0.2, 1 + ias),
      attackRange: scaledRange(def.attackRange + rangeAdd),
      moveSpeed,
      vision: scaledRange(this.isDay ? def.visionDay : def.visionNight),
      magicResistance: def.magicResistance,
      hpRegen,
      manaRegen,
    };
  }

  player(): UnitState {
    const p = this.list.find((u) => u.hero?.isPlayer);
    if (!p) throw new Error('no player hero');
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  // Spawning

  spawn(defId: string, team: Team, x: number, y: number, extra: { lane?: Lane; tier?: Tier; facing?: number } = {}): UnitState {
    const def: UnitDef | undefined = HEROES[defId] ?? UNITS[defId];
    if (!def) throw new Error(`unknown unit def ${defId}`);
    const id = this.nextId++;
    const pos: Vec3 = { x, y, z: 0 };
    const u: UnitState = {
      id,
      def,
      team,
      kind: def.kind,
      position: pos,
      prevPosition: { ...pos },
      facing: extra.facing ?? 0,
      hp: def.hp,
      maxHp: def.hp,
      mana: def.mana,
      maxMana: def.mana,
      alive: true,
      buffs: [],
      order: { type: 'idle' },
      anim: 'idle',
      ...(extra.lane ? { lane: extra.lane } : {}),
      ...(extra.tier ? { tier: extra.tier } : {}),
    };
    if (def.kind === 'hero') {
      const hero: HeroState = {
        def: def as HeroDef,
        level: 1,
        xp: 0,
        skillPoints: 1,
        skillLevels: Object.fromEntries((def as HeroDef).skills.map((s) => [s, 0])),
        cooldownReadyAt: {},
        charges: {},
        reliableGold: 0,
        unreliableGold: GOLD.startingGold,
        items: [null, null, null, null, null, null],
        kills: 0,
        deaths: 0,
        assists: 0,
        lastHits: 0,
        denies: 0,
        respawnAt: null,
        aegis: false,
        isPlayer: false,
      };
      u.hero = hero;
    }
    this.list.push(u);
    this.byId.set(id, u);
    this.rt.set(id, { attackReadyAt: 0, swing: null, pendingCast: null, path: null, pathGoal: null, pathAt: 0, laneRoute: null, removeAt: Infinity });
    this.events.emit('unit:spawned', { unitId: id });
    return u;
  }

  /** Test helper: spawns a hero; `isPlayer` marks the human-controlled one. */
  spawnHero(heroId: string, team: Team, x: number, y: number, opts: { isPlayer?: boolean; level?: number } = {}): UnitState {
    const u = this.spawn(heroId, team, x, y);
    if (opts.isPlayer) u.hero!.isPlayer = true;
    if (opts.level && opts.level > 1) this.setHeroLevel(u, opts.level);
    return u;
  }

  /** Test helper: sets a hero's level (and skill points) directly. */
  setHeroLevel(u: UnitState, level: number): void {
    const h = u.hero!;
    h.skillPoints += level - h.level;
    h.level = level;
    this.refreshHeroPools(u);
  }

  private refreshHeroPools(u: UnitState): void {
    const h = u.hero!;
    const hs = heroStatsAtLevel(h.def, h.level);
    const hpFrac = u.hp / u.maxHp;
    const mpFrac = u.maxMana > 0 ? u.mana / u.maxMana : 1;
    u.maxHp = hs.hp;
    u.maxMana = hs.mana;
    u.hp = Math.max(1, hpFrac * u.maxHp);
    u.mana = mpFrac * u.maxMana;
  }

  // ---------------------------------------------------------------------------------------------
  // Commands

  order(unitId: number, order: Order): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive) return;
    u.order = order;
    const r = this.rt.get(unitId)!;
    r.path = null;
    r.pathGoal = null;
    if (order.type !== 'attack') r.swing = null;
    if (order.type !== 'cast') r.pendingCast = null;
  }

  setUnitPosition(unitId: number, pos: Vec3, facing: number): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive || this.isStunned(u)) return;
    u.position.x = pos.x;
    u.position.y = pos.y;
    u.position.z = pos.z;
    u.facing = facing;
  }

  teleport(unitId: number, x: number, y: number): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    u.position.x = x;
    u.position.y = y;
    u.prevPosition.x = x;
    u.prevPosition.y = y;
    const r = this.rt.get(unitId)!;
    r.path = null;
  }

  dealDamage(req: DamageRequest): number {
    const t = this.byId.get(req.targetId);
    if (!t || !t.alive) return 0;
    if (t.buffs.some((b) => b.invulnerable)) return 0;
    if (req.type === 'magical' && t.buffs.some((b) => b.magicImmune)) return 0;
    const st = this.stats(t.id);
    let amount = req.amount;
    if (req.isAttack) {
      amount *= attackTypeMultiplier(req.attackType ?? 'normal', st.armorType) * armorMultiplier(st.armor);
    } else if (req.type === 'magical') {
      amount *= 1 - st.magicResistance;
    } else if (req.type === 'physical') {
      amount *= armorMultiplier(st.armor);
    }
    amount = Math.max(0, amount);
    t.hp -= amount;
    this.events.emit('unit:damaged', { targetId: t.id, sourceId: req.sourceId, amount, headshot: !!req.headshot });
    if (t.hp <= 0) this.kill(t, req.sourceId);
    return amount;
  }

  heal(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (u?.alive) u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  restoreMana(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (u?.alive) u.mana = Math.min(u.maxMana, Math.max(0, u.mana + amount));
  }

  addBuff(unitId: number, buff: Buff): void {
    const u = this.byId.get(unitId);
    if (!u || !u.alive) return;
    const i = u.buffs.findIndex((b) => b.id === buff.id);
    if (i >= 0) u.buffs[i] = buff;
    else u.buffs.push(buff);
    if (buff.stunned) {
      const r = this.rt.get(unitId)!;
      r.swing = null;
      r.pendingCast = null;
    }
  }

  removeBuff(unitId: number, buffId: string): void {
    const u = this.byId.get(unitId);
    if (u) u.buffs = u.buffs.filter((b) => b.id !== buffId);
  }

  launchProjectile(req: ProjectileRequest): void {
    const s = this.byId.get(req.sourceId);
    if (!s) return;
    const id = this.nextProjectile++;
    this.projectiles.push({ id, sourceId: req.sourceId, targetId: req.targetId, x: s.position.x, y: s.position.y, speed: req.speed, onHit: req.onHit });
    this.events.emit('projectile:launched', { projectileId: id, sourceId: req.sourceId, targetId: req.targetId, visual: req.visual, speed: req.speed });
  }

  castAbility(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string } {
    const res = this.tryCast(unitId, abilityId, target);
    this.castLog.push({ unitId, abilityId, target, time: this.time, ok: res.ok });
    return res;
  }

  private tryCast(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string } {
    const u = this.byId.get(unitId);
    const def = ABILITIES[abilityId];
    if (!u || !u.alive) return { ok: false, reason: 'dead' };
    if (!def) return { ok: false, reason: 'unknown ability' };
    const level = this.abilityLevel(u, abilityId);
    if (level <= 0) return { ok: false, reason: 'not learned' };
    if (this.isStunned(u)) return { ok: false, reason: 'stunned' };
    if (u.buffs.some((b) => b.silenced)) return { ok: false, reason: 'silenced' };
    if ((u.hero?.cooldownReadyAt[abilityId] ?? 0) > this.time) return { ok: false, reason: 'cooldown' };
    const cost = levelValue(def, 'manaCost', level);
    if (u.mana < cost) return { ok: false, reason: 'mana' };
    const range = scaledRange(levelValue(def, 'castRange', level));
    if (range > 0) {
      const p = target.targetId !== undefined ? this.byId.get(target.targetId)?.position : target.point;
      if (!p) return { ok: false, reason: 'no target' };
      if (target.targetId !== undefined && !this.byId.get(target.targetId)!.alive) return { ok: false, reason: 'target dead' };
      if (Math.sqrt(dist2(u.position, p)) > range + 50) return { ok: false, reason: 'range' };
    }
    const r = this.rt.get(unitId)!;
    r.swing = null;
    r.pendingCast = { abilityId, target, at: this.time + def.castPoint };
    u.order = { type: 'cast', abilityId, ...(target.targetId !== undefined ? { targetId: target.targetId } : {}), ...(target.point ? { x: target.point.x, y: target.point.y } : {}) };
    u.anim = 'cast';
    const p = target.targetId !== undefined ? this.byId.get(target.targetId)!.position : target.point;
    if (p && (p.x !== u.position.x || p.y !== u.position.y)) u.facing = Math.atan2(p.y - u.position.y, p.x - u.position.x);
    if (def.castPoint <= 0) this.resolveCast(u);
    return { ok: true };
  }

  learnAbility(unitId: number, abilityId: string): boolean {
    const u = this.byId.get(unitId);
    const h = u?.hero;
    const def = ABILITIES[abilityId];
    if (!h || !def || h.skillPoints <= 0 || !(abilityId in h.skillLevels)) return false;
    const cur = h.skillLevels[abilityId]!;
    if (cur >= def.maxLevel) return false;
    if (h.level < (def.requiredLevels[cur] ?? def.requiredLevels[def.requiredLevels.length - 1]!)) return false;
    h.skillLevels[abilityId] = cur + 1;
    h.skillPoints--;
    return true;
  }

  registerAbility(impl: AbilityImpl): void {
    this.abilities.set(impl.id, impl);
  }

  setPathFinder(pf: PathFinder): void {
    this.pathFinder = pf;
  }

  buyItem(unitId: number, itemId: string): { ok: true } | { ok: false; reason: string } {
    const u = this.byId.get(unitId);
    const h = u?.hero;
    const item = ITEMS[itemId];
    if (!u || !h || !item) return { ok: false, reason: 'invalid' };
    const owned = [...(item.components ?? [])];
    let credit = 0;
    const slotsUsed: number[] = [];
    for (const c of owned) {
      const slot = h.items.findIndex((it, i) => it === c && !slotsUsed.includes(i));
      if (slot >= 0) {
        slotsUsed.push(slot);
        credit += ITEMS[c]?.cost ?? 0;
      }
    }
    const price = item.cost - credit;
    const gold = h.reliableGold + h.unreliableGold;
    if (gold < price) return { ok: false, reason: 'gold' };
    for (const s of slotsUsed) h.items[s] = null;
    const free = h.items.indexOf(null);
    if (free < 0) return { ok: false, reason: 'inventory full' };
    h.items[free] = itemId;
    const fromUnreliable = Math.min(h.unreliableGold, price);
    h.unreliableGold -= fromUnreliable;
    h.reliableGold -= price - fromUnreliable;
    this.events.emit('item:bought', { unitId, itemId });
    return { ok: true };
  }

  buyback(): boolean {
    return false;
  }

  registerBrain(unitId: number, brain: Brain): void {
    this.brains.set(unitId, brain);
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation

  step(dt: number = SIM_DT): void {
    this.time += dt;
    for (const u of this.list) {
      u.prevPosition.x = u.position.x;
      u.prevPosition.y = u.position.y;
    }
    this.updateVisibility();
    this.spawnWaves();
    for (const [id, brain] of this.brains) {
      const u = this.byId.get(id);
      if (u?.alive) brain.update(this, dt);
    }
    for (const u of this.list) {
      if (!u.alive) {
        this.updateDead(u);
        continue;
      }
      this.updateBuffs(u, dt);
      if (!u.alive) continue;
      this.tickAbilities(u, dt);
      if (!u.alive) continue;
      this.updateUnit(u, dt);
      this.regen(u, dt);
    }
    this.updateProjectiles(dt);
    this.passiveGoldAcc += dt;
    while (this.passiveGoldAcc >= GOLD.passiveGoldInterval) {
      this.passiveGoldAcc -= GOLD.passiveGoldInterval;
      if (this.time > 0) for (const u of this.list) if (u.hero) u.hero.unreliableGold += GOLD.passiveGoldAmount;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const u = this.list[i]!;
      if (!u.alive && !u.hero && this.time >= this.rt.get(u.id)!.removeAt) {
        this.list.splice(i, 1);
        this.byId.delete(u.id);
        this.rt.delete(u.id);
      }
    }
  }

  /** Runs the sim for `seconds` of game time. */
  run(seconds: number, dt: number = SIM_DT): void {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.step(dt);
  }

  abilityLevel(u: UnitState, abilityId: string): number {
    if (u.hero) return u.hero.skillLevels[abilityId] ?? (u.def.abilities.includes(abilityId) ? 1 : 0);
    return u.def.abilities.includes(abilityId) ? 1 : 0;
  }

  isStunned(u: UnitState): boolean {
    return u.buffs.some((b) => b.stunned);
  }

  private ctx(u: UnitState, def: AbilityDef, level: number): AbilityContext {
    return { sim: this, caster: u, def, level, value: (key) => levelValue(def, key, level) };
  }

  private tickAbilities(u: UnitState, dt: number): void {
    const ids = u.hero ? Object.keys(u.hero.skillLevels) : u.def.abilities;
    for (const id of ids) {
      const impl = this.abilities.get(id);
      const def = ABILITIES[id];
      if (!impl?.tick || !def) continue;
      const level = this.abilityLevel(u, id);
      if (level > 0) impl.tick(this.ctx(u, def, level), dt);
      if (!u.alive) return;
    }
  }

  private resolveCast(u: UnitState): void {
    const r = this.rt.get(u.id)!;
    const pc = r.pendingCast;
    if (!pc) return;
    r.pendingCast = null;
    const def = ABILITIES[pc.abilityId]!;
    const level = this.abilityLevel(u, pc.abilityId);
    const cost = levelValue(def, 'manaCost', level);
    if (u.mana < cost) return;
    u.mana -= cost;
    if (u.hero) u.hero.cooldownReadyAt[pc.abilityId] = this.time + levelValue(def, 'cooldown', level);
    u.anim = 'idle';
    if (u.order.type === 'cast') u.order = { type: 'idle' };
    const tp = pc.target.targetId !== undefined ? this.byId.get(pc.target.targetId)?.position : pc.target.point;
    this.events.emit('ability:cast', {
      unitId: u.id,
      abilityId: pc.abilityId,
      ...(tp ? { target: { x: tp.x, y: tp.y, z: 0 } } : {}),
      ...(pc.target.targetId !== undefined ? { targetId: pc.target.targetId } : {}),
    });
    this.abilities.get(pc.abilityId)?.cast?.(this.ctx(u, def, level), pc.target);
  }

  private updateBuffs(u: UnitState, dt: number): void {
    if (u.buffs.length === 0) return;
    const now = this.time;
    u.buffs = u.buffs.filter((b) => b.expiresAt > now);
    for (const b of u.buffs) {
      if (b.dps && u.alive) this.dealDamage({ sourceId: b.sourceId, targetId: u.id, amount: b.dps.amount * dt, type: b.dps.type, isAttack: false });
    }
  }

  private regen(u: UnitState, dt: number): void {
    if (u.kind === 'tower' || !u.alive) return;
    const st = this.stats(u.id);
    let hp = st.hpRegen;
    let mp = st.manaRegen;
    if (u.hero) {
      const f = entitiesOfKind(this.map, 'fountain', u.team)[0];
      if (f && dist2(u.position, f) < 1650 * 1650) {
        hp += 0.04 * u.maxHp;
        mp += 0.04 * u.maxMana + 14;
      }
    }
    u.hp = Math.min(u.maxHp, u.hp + hp * dt);
    u.mana = Math.min(u.maxMana, u.mana + mp * dt);
  }

  private updateDead(u: UnitState): void {
    const h = u.hero;
    if (!h || h.respawnAt === null || this.time < h.respawnAt) return;
    const sp = entitiesOfKind(this.map, 'hero_spawn', u.team)[0] ?? entitiesOfKind(this.map, 'fountain', u.team)[0];
    u.alive = true;
    u.hp = u.maxHp;
    u.mana = u.maxMana;
    u.anim = 'idle';
    u.order = { type: 'idle' };
    h.respawnAt = null;
    if (sp) this.teleport(u.id, sp.x, sp.y);
  }

  private kill(t: UnitState, killerId: number | null): void {
    t.alive = false;
    t.hp = 0;
    t.anim = 'death';
    t.buffs = [];
    t.order = { type: 'idle' };
    const r = this.rt.get(t.id)!;
    r.swing = null;
    r.pendingCast = null;
    r.removeAt = this.time + 3;
    const killer = killerId !== null ? this.byId.get(killerId) : undefined;
    const denied = !!killer && killer.team === t.team;
    if (t.hero) {
      t.hero.deaths++;
      t.hero.respawnAt = this.time + respawnTime(t.hero.level);
    }
    if (killer?.hero) {
      if (denied) killer.hero.denies++;
      else if (t.hero) {
        killer.hero.kills++;
        killer.hero.unreliableGold += heroKillGold(t.hero.level, 0);
      } else {
        killer.hero.lastHits++;
        killer.hero.unreliableGold += Math.round((t.def.bountyGoldMin + t.def.bountyGoldMax) / 2);
      }
    }
    if (!denied && killer) {
      const heroes = this.query(t.position.x, t.position.y, 1300, { team: killer.team, kinds: ['hero'] });
      const xp = t.hero ? 100 + 20 * t.hero.level : t.def.bountyXp;
      for (const h of heroes) this.giveXp(h, xp / heroes.length);
    }
    this.events.emit('unit:died', { unitId: t.id, killerId, denied });
    if (t.entityId !== undefined && (t.kind === 'tower' || t.kind.startsWith('barracks') || t.kind === 'ancient')) {
      this.events.emit('building:destroyed', { unitId: t.id, entityId: t.entityId });
    }
  }

  giveXp(u: UnitState, xp: number): void {
    const h = u.hero;
    if (!h) return;
    h.xp += xp;
    const lvl = heroLevelFromXp(h.xp);
    if (lvl > h.level) {
      h.skillPoints += lvl - h.level;
      h.level = lvl;
      this.refreshHeroPools(u);
      this.events.emit('hero:levelUp', { unitId: u.id, level: lvl });
    }
  }

  private updateVisibility(): void {
    for (const team of ['sentinel', 'scourge', 'neutral'] as const) {
      const set = this.visible[team];
      set.clear();
      const viewers = this.list.filter((v) => v.alive && v.team === team);
      for (const u of this.list) {
        if (u.team === team || !u.alive) continue;
        if (u.buffs.some((b) => b.invisible)) continue;
        for (const v of viewers) {
          const r = scaledRange(this.isDay ? v.def.visionDay : v.def.visionNight);
          if (dist2(v.position, u.position) <= r * r) {
            set.add(u.id);
            break;
          }
        }
      }
    }
  }

  private spawnWaves(): void {
    if (this.waveLanes.length === 0 || this.time < this.nextWaveAt) return;
    this.nextWaveAt += 30;
    for (const lane of this.waveLanes) {
      for (const team of ['sentinel', 'scourge'] as const) {
        const wp = this.map.data.lanes[lane];
        const route = team === 'sentinel' ? [...wp] : [...wp].reverse();
        const start = entitiesOfKind(this.map, 'creep_spawn', team).find((e) => e.lane === lane) ?? route[0]!;
        // Skip waypoints behind the spawn point.
        let first = 0;
        let best = Infinity;
        for (let i = 0; i < route.length; i++) {
          const d = dist2(route[i]!, start);
          if (d < best) {
            best = d;
            first = i;
          }
        }
        const kinds = ['creep_melee', 'creep_melee', 'creep_melee', 'creep_ranged'];
        kinds.forEach((k, i) => {
          const u = this.spawn(`${team}_${k}`, team, start.x + (i - 1.5) * 40, start.y + (i % 2) * 40, { lane });
          this.rt.get(u.id)!.laneRoute = route.slice(first + 1);
        });
      }
    }
  }

  private moveToward(u: UnitState, goal: Vec2, dt: number, stopAt = 0): boolean {
    const r = this.rt.get(u.id)!;
    if (!r.path || !r.pathGoal || dist2(r.pathGoal, goal) > 64 * 64 || this.time - r.pathAt > 3) {
      r.path = this.pathFinder?.findPath(u.position, goal, u.def.collisionRadius)?.slice(1) ?? [goal];
      r.pathGoal = { x: goal.x, y: goal.y };
      r.pathAt = this.time;
    }
    const speed = this.stats(u.id).moveSpeed;
    let budget = speed * dt;
    while (budget > 0 && r.path.length > 0) {
      const wp = r.path[0]!;
      const dx = wp.x - u.position.x;
      const dy = wp.y - u.position.y;
      const d = Math.hypot(dx, dy);
      const remainingToGoal = Math.sqrt(dist2(u.position, goal));
      if (r.path.length === 1 && remainingToGoal <= stopAt) return true;
      if (d <= budget) {
        u.position.x = wp.x;
        u.position.y = wp.y;
        budget -= d;
        r.path.shift();
      } else {
        u.position.x += (dx / d) * budget;
        u.position.y += (dy / d) * budget;
        u.facing = Math.atan2(dy, dx);
        budget = 0;
      }
    }
    u.anim = 'walk';
    return r.path.length === 0;
  }

  private nearestEnemy(u: UnitState, radius: number): UnitState | undefined {
    let best: UnitState | undefined;
    let bd = radius * radius;
    for (const v of this.list) {
      if (!v.alive || v.team === u.team || v.kind === 'fountain') continue;
      if (u.team !== 'neutral' && v.team === 'neutral') continue;
      if (u.team === 'neutral' && v.team === 'neutral') continue;
      if (!this.isVisibleTo(u.team, v.id)) continue;
      const d = dist2(u.position, v.position);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  private updateUnit(u: UnitState, dt: number): void {
    const r = this.rt.get(u.id)!;
    if (this.isStunned(u)) {
      u.anim = 'idle';
      return;
    }
    if (r.pendingCast) {
      if (u.buffs.some((b) => b.silenced)) r.pendingCast = null;
      else if (this.time >= r.pendingCast.at) this.resolveCast(u);
      return;
    }
    if (u.hero?.isPlayer) return; // kinematic, driven by tests / the player controller
    const isBuildingish = u.def.moveSpeed === 0;
    // Auto-acquire for units without a brain (creeps, towers, neutrals).
    if (!this.brains.has(u.id) && (u.order.type === 'idle' || u.order.type === 'attackMove' || u.order.type === 'hold')) {
      const acquire = scaledRange(Math.max(u.def.attackRange, isBuildingish ? u.def.attackRange : 500));
      const e = u.def.attackRange > 0 ? this.nearestEnemy(u, acquire) : undefined;
      if (e) {
        this.attackStep(u, e, dt, r, isBuildingish);
        return;
      }
    }
    switch (u.order.type) {
      case 'move': {
        const done = this.moveToward(u, u.order, dt);
        if (done) u.order = { type: 'idle' };
        break;
      }
      case 'attackMove': {
        if (this.moveToward(u, u.order, dt)) u.order = { type: 'idle' };
        break;
      }
      case 'attack': {
        const t = this.byId.get(u.order.targetId);
        if (!t || !t.alive) {
          u.order = { type: 'idle' };
          r.swing = null;
          break;
        }
        this.attackStep(u, t, dt, r, isBuildingish);
        break;
      }
      default: {
        if (r.laneRoute && r.laneRoute.length > 0) {
          const next = r.laneRoute[0]!;
          if (this.moveToward(u, next, dt) || dist2(u.position, next) < 100 * 100) r.laneRoute.shift();
        } else u.anim = r.swing ? 'attack' : 'idle';
      }
    }
  }

  private attackStep(u: UnitState, t: UnitState, dt: number, r: Runtime, immobile: boolean): void {
    const st = this.stats(u.id);
    const reach = st.attackRange + u.def.collisionRadius + t.def.collisionRadius;
    const d = Math.sqrt(dist2(u.position, t.position));
    if (r.swing) {
      if (r.swing.targetId !== t.id) r.swing = null;
      else if (this.time >= r.swing.at) {
        r.swing = null;
        this.fireAttack(u, t, st);
      }
      return;
    }
    if (d > reach) {
      if (!immobile) this.moveToward(u, t.position, dt, reach * 0.9);
      return;
    }
    r.path = null;
    u.facing = Math.atan2(t.position.y - u.position.y, t.position.x - u.position.x);
    if (this.time >= r.attackReadyAt) {
      r.swing = { targetId: t.id, at: this.time + u.def.attackPoint };
      r.attackReadyAt = this.time + st.attackCooldown;
      u.anim = 'attack';
    }
  }

  private fireAttack(u: UnitState, t: UnitState, st: DerivedStats): void {
    this.events.emit('unit:attack', { sourceId: u.id, targetId: t.id });
    const req: DamageRequest = {
      sourceId: u.id,
      targetId: t.id,
      amount: st.damageMin + this.rng.next() * (st.damageMax - st.damageMin),
      type: 'physical',
      isAttack: true,
      attackType: st.attackType,
    };
    const apply = (): void => {
      if (!t.alive) return;
      const ids = u.hero ? Object.keys(u.hero.skillLevels) : u.def.abilities;
      for (const id of ids) {
        const impl = this.abilities.get(id);
        const def = ABILITIES[id];
        const level = this.abilityLevel(u, id);
        if (impl?.onAttack && def && level > 0) impl.onAttack(this.ctx(u, def, level), req);
      }
      this.dealDamage(req);
    };
    if (u.def.projectileSpeed) this.launchProjectile({ sourceId: u.id, targetId: t.id, speed: u.def.projectileSpeed, visual: 'attack', onHit: apply });
    else apply();
  }

  private updateProjectiles(dt: number): void {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const t = this.byId.get(p.targetId);
      if (!t) continue;
      const dx = t.position.x - p.x;
      const dy = t.position.y - p.y;
      const d = Math.hypot(dx, dy);
      const stepLen = p.speed * dt;
      if (d <= stepLen) {
        this.events.emit('projectile:hit', { projectileId: p.id, targetId: p.targetId });
        if (t.alive) p.onHit(this);
        continue;
      }
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  /** Projectiles in flight (dev scene). */
  projectileViews(): ReadonlyArray<{ x: number; y: number }> {
    return this.projectiles;
  }
}
