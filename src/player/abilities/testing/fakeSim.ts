// Minimal SimApi stand-in for developing and testing the Sniper kit before agent E's sim lands. Implements just what
// the kit touches, with simple-but-honest rules: generic mana / cooldown / charges / item use / cast point / range,
// buffs, homing projectiles, armor + magic resistance, onAttack passives inside dealDamage(isAttack).
// Not the real game sim: no AI, no fog, no gold economy.
import { RANGE_SCALE, scaledRange } from '../../../core/config';
import { EventBus } from '../../../core/events';
import { groundHeightAt } from '../../../core/map';
import type { LoadedMap } from '../../../core/map';
import { createRng } from '../../../core/rng';
import type { Rng } from '../../../core/rng';
import type {
  AbilityContext,
  AbilityImpl,
  Buff,
  CastTarget,
  DamageRequest,
  DerivedStats,
  HeroState,
  Order,
  PathFinder,
  ProjectileRequest,
  SimApi,
  UnitQuery,
  UnitState,
} from '../../../core/sim';
import type { AbilityDef, GameEvents, HeroDef, Lane, Team, Tier, Vec2, Vec3 } from '../../../core/types';
import { ABILITIES, HEROES, ITEMS, UNITS, armorMultiplier, attackTypeMultiplier, heroStatsAtLevel, levelValue } from '../../../data';

/** Optional HeroState extension the kit reads for the charge timer (see CONTRACT_REQUESTS.md, F2). */
export interface ChargeTimers {
  /** abilityId → sim time when the next charge comes back. */
  chargeRestoreAt?: Record<string, number>;
}

interface PendingCast {
  unitId: number;
  abilityId: string;
  level: number;
  target: CastTarget;
  resolveAt: number;
  itemSlot: number;
}

interface Projectile extends ProjectileRequest {
  id: number;
  pos: Vec3;
}

const CONSUMABLES: ReadonlySet<string> = new Set(['tpscroll', 'healing_salve', 'clarity_potion', 'tango']);
const HIT_Z = 60;

export interface FakeSimOptions {
  map: LoadedMap;
  seed?: number;
  events?: EventBus<GameEvents>;
}

export class FakeSim implements SimApi {
  readonly map: LoadedMap;
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  time = 0;
  timeOfDay = 0.3;
  /** Units hidden from the other teams (fog stand-in for tests). */
  readonly hidden = new Set<number>();
  /** Every damage dealt (tests). */
  readonly damageLog: Array<{ targetId: number; sourceId: number | null; amount: number; type: string; abilityId?: string; headshot: boolean; t: number }> = [];

  private readonly list: UnitState[] = [];
  private readonly byId = new Map<number, UnitState>();
  private readonly impls = new Map<string, AbilityImpl>();
  private pending: PendingCast[] = [];
  private projectiles: Projectile[] = [];
  private nextUnitId = 1;
  private nextProjectileId = 1;
  private playerId: number | null = null;

  constructor(opts: FakeSimOptions) {
    this.map = opts.map;
    this.events = opts.events ?? new EventBus<GameEvents>();
    this.rng = createRng(opts.seed ?? 1);
  }

  get isDay(): boolean {
    return this.timeOfDay < 0.5;
  }

  // --- queries ---------------------------------------------------------------------------------

  units(): readonly UnitState[] {
    return this.list;
  }

  get(id: number): UnitState | undefined {
    return this.byId.get(id);
  }

  query(x: number, y: number, radius: number, q: UnitQuery = {}): UnitState[] {
    const out: UnitState[] = [];
    const r2 = radius * radius;
    for (const u of this.list) {
      if ((q.aliveOnly ?? true) && !u.alive) continue;
      if (q.team && u.team !== q.team) continue;
      if (q.notTeam && u.team === q.notTeam) continue;
      if (q.kinds && !q.kinds.includes(u.kind)) continue;
      if (q.visibleTo && !this.isVisibleTo(q.visibleTo, u.id)) continue;
      const dx = u.position.x - x;
      const dy = u.position.y - y;
      if (dx * dx + dy * dy <= r2) out.push(u);
    }
    return out;
  }

  stats(unitId: number): DerivedStats {
    const u = this.need(unitId);
    const def = u.def;
    let damageMin = def.damageMin;
    let damageMax = def.damageMax;
    let armor = def.armor;
    let ias = 0;
    let baseCooldown = def.attackCooldown;
    let hpRegen = def.hpRegen;
    let manaRegen = def.manaRegen;
    if (u.hero) {
      const hs = heroStatsAtLevel(u.hero.def, u.hero.level);
      damageMin = hs.damageMin;
      damageMax = hs.damageMax;
      armor = hs.armor;
      ias = hs.attackSpeedBonus;
      baseCooldown = u.hero.def.attackCooldown;
      hpRegen = hs.hpRegen;
      manaRegen = hs.manaRegen;
    }
    let movePct = 0;
    let range = def.attackRange;
    let damagePct = 0;
    for (const b of u.buffs) {
      movePct += b.moveSpeedPct ?? 0;
      ias += b.attackSpeed ?? 0;
      armor += b.armor ?? 0;
      damageMin += b.damage ?? 0;
      damageMax += b.damage ?? 0;
      range += b.attackRange ?? 0;
      damagePct += b.damagePct ?? 0;
    }
    return {
      damageMin: damageMin * (1 + damagePct),
      damageMax: damageMax * (1 + damagePct),
      armor,
      armorType: def.armorType,
      attackType: def.attackType,
      attackCooldown: baseCooldown / (1 + ias),
      attackRange: range * RANGE_SCALE,
      moveSpeed: Math.max(0, def.moveSpeed * (1 + movePct)),
      vision: scaledRange(this.isDay ? def.visionDay : def.visionNight),
      magicResistance: def.magicResistance,
      hpRegen,
      manaRegen,
    };
  }

  isVisibleTo(team: Team, unitId: number): boolean {
    const u = this.byId.get(unitId);
    if (!u) return false;
    if (u.team === team) return true;
    if (this.hidden.has(unitId)) return false;
    return !u.buffs.some((b) => b.invisible && b.expiresAt > this.time);
  }

  player(): UnitState {
    if (this.playerId === null) throw new Error('FakeSim: no player hero spawned');
    return this.need(this.playerId);
  }

  // --- spawning ----------------------------------------------------------------------------------

  spawn(defId: string, team: Team, x: number, y: number, extra: { lane?: Lane; tier?: Tier; facing?: number; entityId?: number } = {}): UnitState {
    const def = UNITS[defId];
    if (!def) throw new Error(`FakeSim: unknown unit ${defId}`);
    const z = groundHeightAt(this.map, x, y);
    const u: UnitState = {
      id: this.nextUnitId++,
      def,
      team,
      kind: def.kind,
      position: { x, y, z },
      prevPosition: { x, y, z },
      facing: extra.facing ?? 0,
      hp: def.hp,
      maxHp: def.hp,
      mana: def.mana,
      maxMana: def.mana,
      alive: true,
      lane: extra.lane,
      tier: extra.tier,
      entityId: extra.entityId,
      buffs: [],
      order: { type: 'idle' },
      anim: 'idle',
    };
    const heroDef = HEROES[defId];
    if (heroDef) u.hero = this.newHeroState(heroDef);
    this.list.push(u);
    this.byId.set(u.id, u);
    this.events.emit('unit:spawned', { unitId: u.id });
    return u;
  }

  /** Spawns a hero at a level (with that many skill points) and optionally makes it the player. */
  spawnHero(defId: string, team: Team, x: number, y: number, opts: { level?: number; isPlayer?: boolean } = {}): UnitState {
    const u = this.spawn(defId, team, x, y);
    if (opts.isPlayer) {
      u.hero!.isPlayer = true;
      this.playerId = u.id;
    }
    this.setLevel(u.id, opts.level ?? 1);
    return u;
  }

  setLevel(unitId: number, level: number): void {
    const u = this.need(unitId);
    const h = u.hero;
    if (!h) return;
    h.level = level;
    const spent = Object.values(h.skillLevels).reduce((s, v) => s + v, 0);
    h.skillPoints = Math.max(0, level - spent);
    const hs = heroStatsAtLevel(h.def, level);
    const hpFrac = u.hp / u.maxHp;
    u.maxHp = hs.hp;
    u.hp = u.maxHp * hpFrac;
    u.maxMana = hs.mana;
    u.mana = hs.mana;
  }

  addItem(unitId: number, itemId: string): boolean {
    const h = this.need(unitId).hero;
    if (!h || !ITEMS[itemId]) return false;
    const slot = h.items.indexOf(null);
    if (slot < 0) return false;
    h.items[slot] = itemId;
    return true;
  }

  revive(unitId: number): void {
    const u = this.need(unitId);
    u.alive = true;
    u.hp = u.maxHp;
    u.buffs.length = 0;
    u.anim = 'idle';
  }

  /** Clears cooldowns, refills mana and charges (dev hotkey). */
  refresh(unitId: number): void {
    const u = this.need(unitId);
    u.mana = u.maxMana;
    const h = u.hero;
    if (!h) return;
    for (const k of Object.keys(h.cooldownReadyAt)) h.cooldownReadyAt[k] = this.time;
    for (const k of Object.keys(h.charges)) {
      const def = ABILITIES[k];
      if (def) h.charges[k] = levelValue(def, 'charges', h.skillLevels[k] ?? 1);
    }
    (h as HeroState & ChargeTimers).chargeRestoreAt = {};
  }

  // --- orders / movement -------------------------------------------------------------------------

  order(unitId: number, order: Order): void {
    this.need(unitId).order = order;
  }

  setUnitPosition(unitId: number, pos: Vec3, facing: number): void {
    const u = this.need(unitId);
    if (this.isStunned(u)) return;
    u.position.x = pos.x;
    u.position.y = pos.y;
    u.position.z = pos.z;
    u.facing = facing;
  }

  teleport(unitId: number, x: number, y: number): void {
    const u = this.need(unitId);
    u.position.x = x;
    u.position.y = y;
    u.position.z = groundHeightAt(this.map, x, y);
    u.prevPosition.x = u.position.x;
    u.prevPosition.y = u.position.y;
    u.prevPosition.z = u.position.z;
  }

  // --- combat --------------------------------------------------------------------------------------

  dealDamage(req: DamageRequest): number {
    const target = this.byId.get(req.targetId);
    if (!target || !target.alive) return 0;
    const now = this.time;
    if (target.buffs.some((b) => b.invulnerable && b.expiresAt > now)) return 0;
    const source = req.sourceId !== null ? this.byId.get(req.sourceId) : undefined;
    // Basic attacks run the attacker's onAttack passives first (Headshot).
    if (req.isAttack && source?.hero) {
      for (const [abilityId, level] of Object.entries(source.hero.skillLevels)) {
        const impl = this.impls.get(abilityId);
        if (level > 0 && impl?.onAttack) impl.onAttack(this.context(source, abilityId, level), req);
      }
    }
    let amount = req.amount;
    if (req.type === 'physical') {
      const st = this.stats(target.id);
      if (req.isAttack) amount *= attackTypeMultiplier(req.attackType ?? 'normal', st.armorType);
      amount *= armorMultiplier(st.armor);
    } else if (req.type === 'magical') {
      if (target.buffs.some((b) => b.magicImmune && b.expiresAt > now)) return 0;
      amount *= 1 - target.def.magicResistance;
    }
    amount = Math.max(0, Math.min(amount, target.hp));
    target.hp -= amount;
    const headshot = req.headshot === true;
    this.damageLog.push({ targetId: target.id, sourceId: req.sourceId, amount, type: req.type, abilityId: req.abilityId, headshot, t: now });
    this.events.emit('unit:damaged', { targetId: target.id, sourceId: req.sourceId, amount, headshot });
    if (target.hp <= 1e-6) {
      target.hp = 0;
      target.alive = false;
      target.anim = 'death';
      this.events.emit('unit:died', { unitId: target.id, killerId: req.sourceId, denied: source?.team === target.team });
    }
    return amount;
  }

  /** The player's / a unit's basic attack (dev + tests): rolls damage and runs dealDamage with isAttack. */
  attack(sourceId: number, targetId: number, opts: { headshot?: boolean } = {}): number {
    const st = this.stats(sourceId);
    const amount = this.rng.range(st.damageMin, st.damageMax);
    return this.dealDamage({ sourceId, targetId, amount, type: 'physical', isAttack: true, attackType: st.attackType, headshot: opts.headshot });
  }

  heal(unitId: number, amount: number): void {
    const u = this.need(unitId);
    u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  restoreMana(unitId: number, amount: number): void {
    const u = this.need(unitId);
    u.mana = Math.min(u.maxMana, u.mana + amount);
  }

  addBuff(unitId: number, buff: Buff): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    const i = u.buffs.findIndex((b) => b.id === buff.id);
    if (i >= 0) u.buffs[i] = { ...buff };
    else u.buffs.push({ ...buff });
  }

  removeBuff(unitId: number, buffId: string): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    const i = u.buffs.findIndex((b) => b.id === buffId);
    if (i >= 0) u.buffs.splice(i, 1);
  }

  launchProjectile(req: ProjectileRequest): void {
    const src = this.need(req.sourceId);
    const p: Projectile = { ...req, id: this.nextProjectileId++, pos: { x: src.position.x, y: src.position.y, z: src.position.z + HIT_Z } };
    this.projectiles.push(p);
    this.events.emit('projectile:launched', { projectileId: p.id, sourceId: p.sourceId, targetId: p.targetId, visual: p.visual, speed: p.speed });
  }

  get projectileCount(): number {
    return this.projectiles.length;
  }

  // --- abilities -----------------------------------------------------------------------------------

  registerAbility(impl: AbilityImpl): void {
    this.impls.set(impl.id, impl);
  }

  setPathFinder(_pf: PathFinder): void {
    // Not needed by the kit.
  }

  learnAbility(unitId: number, abilityId: string): boolean {
    const u = this.byId.get(unitId);
    const h = u?.hero;
    const def = ABILITIES[abilityId];
    if (!u || !h || !def || !h.def.skills.includes(abilityId) || h.skillPoints <= 0) return false;
    const current = h.skillLevels[abilityId] ?? 0;
    if (current >= def.maxLevel) return false;
    if (h.level < (def.requiredLevels[current] ?? Infinity)) return false;
    h.skillLevels[abilityId] = current + 1;
    h.skillPoints--;
    if (def.values.charges && current === 0) h.charges[abilityId] = levelValue(def, 'charges', 1);
    return true;
  }

  castAbility(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string } {
    const u = this.byId.get(unitId);
    const def = ABILITIES[abilityId];
    if (!u || !def) return { ok: false, reason: 'Unknown ability' };
    if (!u.alive) return { ok: false, reason: 'Dead' };
    if (this.pending.some((p) => p.unitId === unitId)) return { ok: false, reason: 'Busy casting' };
    const h = u.hero;
    let level = h?.skillLevels[abilityId] ?? 0;
    let itemSlot = -1;
    if (def.kind === 'item') {
      itemSlot = h ? h.items.findIndex((it) => it !== null && ITEMS[it]?.active === abilityId) : -1;
      if (itemSlot < 0) return { ok: false, reason: 'Item not in inventory' };
      level = 1;
    }
    if (level <= 0) return { ok: false, reason: 'Not learned' };
    const now = this.time;
    if (this.isStunned(u)) return { ok: false, reason: 'Stunned' };
    if (u.buffs.some((b) => b.silenced && b.expiresAt > now)) return { ok: false, reason: 'Silenced' };
    if ((h?.cooldownReadyAt[abilityId] ?? -Infinity) > now + 1e-9) return { ok: false, reason: 'On cooldown' };
    if (def.values.charges && (h?.charges[abilityId] ?? 0) <= 0) return { ok: false, reason: 'No charges' };
    if (u.mana + 1e-9 < levelValue(def, 'manaCost', level)) return { ok: false, reason: 'Not enough mana' };
    const range = levelValue(def, 'castRange', level);
    const p = this.targetPoint(target);
    if (def.targeting === 'point' && !p) return { ok: false, reason: 'No target point' };
    if (def.targeting === 'unit' || def.targeting === 'hero') {
      const t = target.targetId !== undefined ? this.byId.get(target.targetId) : undefined;
      if (!t || !t.alive) return { ok: false, reason: 'Invalid target' };
      if (abilityId === 'sniper_assassinate' && (t.kind !== 'hero' || t.team === u.team)) return { ok: false, reason: 'Must target an enemy hero' };
      if (!this.isVisibleTo(u.team, t.id)) return { ok: false, reason: 'Target not visible' };
    }
    if (range > 0 && def.targeting !== 'none' && p) {
      if (Math.hypot(p.x - u.position.x, p.y - u.position.y) > scaledRange(range) + 1e-6) return { ok: false, reason: 'Out of range' };
    }
    this.pending.push({ unitId, abilityId, level, target, resolveAt: now + def.castPoint, itemSlot });
    return { ok: true };
  }

  buyItem(unitId: number, itemId: string): { ok: true } | { ok: false; reason: string } {
    return this.addItem(unitId, itemId) ? { ok: true } : { ok: false, reason: 'Inventory full' };
  }

  buyback(): boolean {
    return false;
  }

  // --- simulation ------------------------------------------------------------------------------------

  step(dt: number): void {
    this.time += dt;
    const now = this.time;
    for (const u of this.list) {
      u.prevPosition.x = u.position.x;
      u.prevPosition.y = u.position.y;
      u.prevPosition.z = u.position.z;
      for (let i = u.buffs.length - 1; i >= 0; i--) if (u.buffs[i]!.expiresAt <= now) u.buffs.splice(i, 1);
      if (u.alive) {
        const st = this.stats(u.id);
        u.mana = Math.min(u.maxMana, u.mana + st.manaRegen * dt);
      }
    }
    this.resolveCasts(now);
    this.moveProjectiles(dt);
    this.restoreCharges(now);
    for (const u of this.list) {
      if (!u.alive || !u.hero) continue;
      for (const [abilityId, level] of Object.entries(u.hero.skillLevels)) {
        const impl = this.impls.get(abilityId);
        if (level > 0 && impl?.tick) impl.tick(this.context(u, abilityId, level), dt);
      }
      for (const item of u.hero.items) {
        const active = item ? ITEMS[item]?.active : undefined;
        const impl = active ? this.impls.get(active) : undefined;
        if (active && impl?.tick) impl.tick(this.context(u, active, 1), dt);
      }
    }
  }

  // --- internals -------------------------------------------------------------------------------------

  private newHeroState(def: HeroDef): HeroState {
    return {
      def,
      level: 1,
      xp: 0,
      skillPoints: 1,
      skillLevels: Object.fromEntries(def.skills.map((s) => [s, 0])),
      cooldownReadyAt: {},
      charges: {},
      reliableGold: 0,
      unreliableGold: 625,
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
  }

  private need(id: number): UnitState {
    const u = this.byId.get(id);
    if (!u) throw new Error(`FakeSim: no unit ${id}`);
    return u;
  }

  private isStunned(u: UnitState): boolean {
    return u.buffs.some((b) => b.stunned && b.expiresAt > this.time);
  }

  private targetPoint(target: CastTarget): Vec2 | null {
    if (target.point) return target.point;
    if (target.targetId !== undefined) {
      const t = this.byId.get(target.targetId);
      if (t) return { x: t.position.x, y: t.position.y };
    }
    return null;
  }

  private context(caster: UnitState, abilityId: string, level: number): AbilityContext {
    const def = ABILITIES[abilityId] as AbilityDef;
    return { sim: this, caster, def, level, value: (key) => levelValue(def, key, level) };
  }

  private resolveCasts(now: number): void {
    if (this.pending.length === 0) return;
    const due = this.pending.filter((p) => p.resolveAt <= now + 1e-9);
    if (due.length === 0) return;
    this.pending = this.pending.filter((p) => p.resolveAt > now + 1e-9);
    for (const c of due) {
      const u = this.byId.get(c.unitId);
      const def = ABILITIES[c.abilityId];
      if (!u || !def || !u.alive || this.isStunned(u)) continue;
      const h = u.hero;
      u.mana -= levelValue(def, 'manaCost', c.level);
      if (h) {
        const cd = levelValue(def, 'cooldown', c.level);
        if (cd > 0) h.cooldownReadyAt[c.abilityId] = now + cd;
        if (def.values.charges) {
          h.charges[c.abilityId] = (h.charges[c.abilityId] ?? 0) - 1;
          const timers = ((h as HeroState & ChargeTimers).chargeRestoreAt ??= {});
          if (timers[c.abilityId] === undefined) timers[c.abilityId] = now + levelValue(def, 'chargeRestoreTime', c.level);
        }
        if (c.itemSlot >= 0) {
          const item = h.items[c.itemSlot];
          if (item && CONSUMABLES.has(item)) h.items[c.itemSlot] = null;
        }
      }
      u.anim = 'cast';
      const p = this.targetPoint(c.target);
      this.events.emit('ability:cast', {
        unitId: u.id,
        abilityId: c.abilityId,
        target: p ? { x: p.x, y: p.y, z: groundHeightAt(this.map, p.x, p.y) } : undefined,
        targetId: c.target.targetId,
      });
      this.impls.get(c.abilityId)?.cast?.(this.context(u, c.abilityId, c.level), c.target);
    }
  }

  private moveProjectiles(dt: number): void {
    if (this.projectiles.length === 0) return;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const t = this.byId.get(p.targetId);
      if (!t) continue;
      const tx = t.position.x;
      const ty = t.position.y;
      const tz = t.position.z + HIT_Z;
      const d = Math.hypot(tx - p.pos.x, ty - p.pos.y, tz - p.pos.z);
      const stepLen = p.speed * dt;
      if (d <= stepLen) {
        this.events.emit('projectile:hit', { projectileId: p.id, targetId: p.targetId });
        if (t.alive) p.onHit(this);
        continue;
      }
      p.pos.x += ((tx - p.pos.x) / d) * stepLen;
      p.pos.y += ((ty - p.pos.y) / d) * stepLen;
      p.pos.z += ((tz - p.pos.z) / d) * stepLen;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private restoreCharges(now: number): void {
    for (const u of this.list) {
      const h = u.hero as (HeroState & ChargeTimers) | undefined;
      const timers = h?.chargeRestoreAt;
      if (!h || !timers) continue;
      for (const [abilityId, at] of Object.entries(timers)) {
        if (at > now + 1e-9) continue;
        const def = ABILITIES[abilityId]!;
        const level = Math.max(1, h.skillLevels[abilityId] ?? 1);
        const max = levelValue(def, 'charges', level);
        h.charges[abilityId] = Math.min(max, (h.charges[abilityId] ?? 0) + 1);
        if (h.charges[abilityId]! < max) timers[abilityId] = at + levelValue(def, 'chargeRestoreTime', level);
        else delete timers[abilityId];
      }
    }
  }
}

export const createFakeSim = (opts: FakeSimOptions): FakeSim => new FakeSim(opts);
