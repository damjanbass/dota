// Fake SimApi for UI development (?scene=ui) until agent E's sim lands. Not authoritative DotA rules:
// a toy lane fight, scriptable kills / gold / cooldowns and the events the HUD listens to.
import { SIM_DT, scaledRange } from '../../core/config';
import { EventBus } from '../../core/events';
import { groundHeightAt } from '../../core/map';
import type { LoadedMap } from '../../core/map';
import { createRng } from '../../core/rng';
import type { Rng } from '../../core/rng';
import type {
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
  SimApi,
  UnitQuery,
  UnitState,
} from '../../core/sim';
import type { GameEvents, HeroDef, Lane, Team, Tier, UnitDef, UnitKind, Vec2, Vec3 } from '../../core/types';
import { ABILITIES, GOLD, HEROES, HERO_XP, ITEMS, UNITS, buybackCost, heroLevelFromXp, heroStatsAtLevel, levelValue, respawnTime } from '../../data';

export interface FakeSimOptions {
  map: LoadedMap;
  config?: Partial<MatchConfig>;
  /** Player hero spawn (default: Sentinel fountain area). */
  playerAt?: Vec2;
  /** Sim time at start (seconds since the horn). */
  startTime?: number;
  /** Toy creep waves + random scripted events. */
  demo?: boolean;
  /** Where the toy lane fight happens (default: middle of the mid lane). */
  front?: Vec2;
}

/** UI hint radius for "near a shop" in the fake (the real value belongs to the sim). */
export const FAKE_SHOP_RANGE = 600;

const CYCLE = 480;
const BUILDING_KINDS: ReadonlySet<UnitKind> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);
const STREAK_TEXT: Record<number, string> = {
  3: 'is on a KILLING SPREE!',
  4: 'is DOMINATING!',
  5: 'has a MEGA KILL!',
  6: 'is UNSTOPPABLE!',
  7: 'is WICKED SICK!',
  8: 'has a MONSTER KILL!',
  9: 'is GODLIKE!',
  10: 'is BEYOND GODLIKE!',
};
const MULTI_TEXT: Record<number, string> = { 2: 'Double Kill!', 3: 'Triple Kill!', 4: 'Ultra Kill!', 5: 'Rampage!' };

interface Pending {
  at: number;
  run: () => void;
}

export class FakeSim implements SimApi {
  readonly map: LoadedMap;
  readonly events = new EventBus<GameEvents>();
  readonly rng: Rng;
  readonly config: MatchConfig;
  time: number;
  demo: boolean;
  /** Freeze the clock and all toy AI (for screenshots). */
  frozen = false;

  private readonly list: UnitState[] = [];
  private readonly byId = new Map<number, UnitState>();
  private nextId = 1;
  private playerId = 0;
  private readonly visible = { sentinel: new Set<number>(), scourge: new Set<number>(), neutral: new Set<number>() };
  private readonly pending: Pending[] = [];
  private readonly streak = new Map<number, number>();
  private readonly multi = new Map<number, { count: number; at: number }>();
  private readonly attackReadyAt = new Map<number, number>();
  private firstBlood = false;
  private passiveGoldAt = 0;
  private nextWaveAt = 0;
  private nextScriptAt = 3;
  private readonly front: Vec2;
  private readonly frontDir: Vec2;
  private readonly impls = new Map<string, AbilityImpl>();
  private ended = false;

  constructor(opts: FakeSimOptions) {
    this.map = opts.map;
    this.rng = createRng(opts.config?.seed ?? 1234);
    this.config = {
      seed: 1234,
      playerHero: 'sniper',
      allies: ['pudge', 'lion', 'viper', 'lich'],
      enemies: ['shadow_fiend', 'pudge', 'lion', 'viper', 'lich'],
      difficulty: 'medium',
      ...opts.config,
    };
    this.time = opts.startTime ?? 0;
    this.demo = opts.demo ?? false;
    const mid = this.map.data.lanes.mid;
    const a = mid[Math.floor(mid.length / 2) - 1] ?? mid[0]!;
    const b = mid[Math.floor(mid.length / 2)] ?? mid[mid.length - 1]!;
    this.front = opts.front ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.frontDir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };

    this.spawnBuildings();
    const fountain = this.map.data.entities.find((e) => e.kind === 'fountain' && e.team === 'sentinel');
    const at = opts.playerAt ?? (fountain ? { x: fountain.x + 300, y: fountain.y + 300 } : { x: 0, y: 0 });
    const player = this.spawnHero(this.config.playerHero, 'sentinel', at.x, at.y, true);
    this.playerId = player.id;
    this.config.allies.forEach((id, i) => {
      const p = this.lanePoint(i % 2 === 0 ? 'top' : 'bot', 0.3, 'sentinel');
      this.spawnHero(id, 'sentinel', p.x + i * 40, p.y);
    });
    this.config.enemies.forEach((id, i) => {
      const p = i === 0 ? this.offsetFront(700, 120) : this.lanePoint(i % 2 === 0 ? 'top' : 'bot', 0.3, 'scourge');
      this.spawnHero(id, 'scourge', p.x - i * 40, p.y);
    });
    this.spawnNeutrals();
    if (this.demo) this.spawnWave();
    this.nextWaveAt = this.time + 30;
    this.refreshVisibility();
  }

  // --- SimApi: time -----------------------------------------------------------------------------

  get timeOfDay(): number {
    return (((this.time % CYCLE) + CYCLE) % CYCLE) / CYCLE;
  }

  get isDay(): boolean {
    return this.timeOfDay < 0.5;
  }

  // --- SimApi: queries ----------------------------------------------------------------------------

  units(): readonly UnitState[] {
    return this.list;
  }

  get(id: number): UnitState | undefined {
    return this.byId.get(id);
  }

  player(): UnitState {
    return this.byId.get(this.playerId)!;
  }

  query(x: number, y: number, radius: number, q: UnitQuery = {}): UnitState[] {
    const r2 = radius * radius;
    return this.list.filter((u) => {
      if (q.aliveOnly !== false && !u.alive) return false;
      if (q.team && u.team !== q.team) return false;
      if (q.notTeam && u.team === q.notTeam) return false;
      if (q.kinds && !q.kinds.includes(u.kind)) return false;
      if (q.visibleTo && !this.isVisibleTo(q.visibleTo, u.id)) return false;
      const dx = u.position.x - x;
      const dy = u.position.y - y;
      return dx * dx + dy * dy <= r2;
    });
  }

  stats(unitId: number): DerivedStats {
    const u = this.byId.get(unitId);
    if (!u) throw new Error(`no unit ${unitId}`);
    const d = u.def;
    let dmgMin = d.damageMin;
    let dmgMax = d.damageMax;
    let armor = d.armor;
    let cd = d.attackCooldown;
    if (u.hero) {
      const s = heroStatsAtLevel(u.hero.def, u.hero.level);
      dmgMin = s.damageMin;
      dmgMax = s.damageMax;
      armor = s.armor;
      cd = s.attackCooldown;
    }
    const takeAim = u.hero ? (u.hero.skillLevels.sniper_take_aim ?? 0) : 0;
    const bonusRange = takeAim > 0 ? levelValue(ABILITIES.sniper_take_aim!, 'bonusAttackRange', takeAim) : 0;
    return {
      damageMin: dmgMin,
      damageMax: dmgMax,
      armor,
      armorType: d.armorType,
      attackType: d.attackType,
      attackCooldown: cd,
      attackRange: scaledRange(d.attackRange + bonusRange),
      moveSpeed: d.moveSpeed,
      vision: scaledRange(this.isDay ? d.visionDay : d.visionNight),
      magicResistance: d.magicResistance,
      hpRegen: d.hpRegen,
      manaRegen: d.manaRegen,
    };
  }

  isVisibleTo(team: Team, unitId: number): boolean {
    const u = this.byId.get(unitId);
    if (!u) return false;
    if (u.team === team) return true;
    return this.visible[team].has(unitId);
  }

  // --- SimApi: mutation ---------------------------------------------------------------------------

  spawn(defId: string, team: Team, x: number, y: number, extra: { lane?: Lane; tier?: Tier; facing?: number } = {}): UnitState {
    const def = UNITS[defId];
    if (!def) throw new Error(`unknown unit def ${defId}`);
    return this.addUnit(def, team, x, y, extra);
  }

  order(unitId: number, order: Order): void {
    const u = this.byId.get(unitId);
    if (u) u.order = order;
  }

  setUnitPosition(unitId: number, pos: Vec3, facing: number): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    u.position.x = pos.x;
    u.position.y = pos.y;
    u.position.z = pos.z;
    u.facing = facing;
  }

  teleport(unitId: number, x: number, y: number): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    const z = groundHeightAt(this.map, x, y);
    u.position = { x, y, z };
    u.prevPosition = { x, y, z };
  }

  dealDamage(req: DamageRequest): number {
    const t = this.byId.get(req.targetId);
    if (!t || !t.alive) return 0;
    if (t.buffs.some((b) => b.invulnerable)) return 0;
    let amount = req.amount;
    if (req.headshot && req.sourceId !== null) {
      const src = this.byId.get(req.sourceId);
      const lvl = src?.hero?.skillLevels.sniper_headshot ?? 0;
      if (lvl > 0) amount += levelValue(ABILITIES.sniper_headshot!, 'bonusDamage', lvl);
    }
    if (req.isAttack) amount *= 1 / (1 + 0.06 * Math.max(0, this.armorOf(t)));
    amount = Math.max(0, Math.min(t.hp, amount));
    t.hp -= amount;
    this.events.emit('unit:damaged', { targetId: t.id, sourceId: req.sourceId, amount, headshot: req.headshot ?? false });
    if (t.hp <= 0.5) this.kill(t, req.sourceId);
    return amount;
  }

  heal(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (u && u.alive) u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  restoreMana(unitId: number, amount: number): void {
    const u = this.byId.get(unitId);
    if (u && u.alive) u.mana = Math.min(u.maxMana, u.mana + amount);
  }

  addBuff(unitId: number, buff: Buff): void {
    const u = this.byId.get(unitId);
    if (!u) return;
    u.buffs = u.buffs.filter((b) => b.id !== buff.id);
    u.buffs.push(buff);
  }

  removeBuff(unitId: number, buffId: string): void {
    const u = this.byId.get(unitId);
    if (u) u.buffs = u.buffs.filter((b) => b.id !== buffId);
  }

  launchProjectile(req: ProjectileRequest): void {
    const s = this.byId.get(req.sourceId);
    const t = this.byId.get(req.targetId);
    if (!s || !t) return;
    const dist = Math.hypot(t.position.x - s.position.x, t.position.y - s.position.y);
    this.later(dist / Math.max(1, req.speed), () => req.onHit(this));
  }

  castAbility(unitId: number, abilityId: string, target: CastTarget): { ok: true } | { ok: false; reason: string } {
    const u = this.byId.get(unitId);
    const def = ABILITIES[abilityId];
    if (!u || !u.hero || !def) return { ok: false, reason: 'Unknown ability' };
    if (!u.alive) return { ok: false, reason: 'You are dead' };
    const h = u.hero;
    const isItem = def.kind === 'item';
    const level = isItem ? 1 : (h.skillLevels[abilityId] ?? 0);
    if (level <= 0) return { ok: false, reason: 'Ability not learned' };
    if (isItem && !h.items.some((id) => id && ITEMS[id]?.active === abilityId)) return { ok: false, reason: 'No item' };
    const maxCharges = def.values.charges ? levelValue(def, 'charges', level) : 0;
    if (maxCharges > 0) {
      if ((h.charges[abilityId] ?? 0) <= 0) return { ok: false, reason: 'No charges' };
    } else if ((h.cooldownReadyAt[abilityId] ?? -Infinity) > this.time) return { ok: false, reason: 'Ability on cooldown' };
    const mana = levelValue(def, 'manaCost', level);
    if (u.mana < mana) return { ok: false, reason: 'Not enough mana' };
    u.mana -= mana;
    if (maxCharges > 0) {
      const before = h.charges[abilityId] ?? 0;
      h.charges[abilityId] = before - 1;
      // Interpretation used by the HUD: cooldownReadyAt = when the next charge comes back.
      if (before >= maxCharges) h.cooldownReadyAt[abilityId] = this.time + levelValue(def, 'chargeRestoreTime', level);
    } else {
      h.cooldownReadyAt[abilityId] = this.time + levelValue(def, 'cooldown', level);
    }
    if (isItem && abilityId === 'item_tpscroll') {
      const slot = h.items.indexOf('tpscroll');
      if (slot >= 0) h.items[slot] = null;
    }
    const tp = target.point ? { x: target.point.x, y: target.point.y, z: groundHeightAt(this.map, target.point.x, target.point.y) } : undefined;
    this.events.emit('ability:cast', { unitId, abilityId, target: tp, targetId: target.targetId });
    return { ok: true };
  }

  learnAbility(unitId: number, abilityId: string): boolean {
    const h = this.byId.get(unitId)?.hero;
    const def = ABILITIES[abilityId];
    if (!h || !def || h.skillPoints <= 0 || !h.def.skills.includes(abilityId)) return false;
    const cur = h.skillLevels[abilityId] ?? 0;
    if (cur >= def.maxLevel) return false;
    const req = def.requiredLevels[cur] ?? def.requiredLevels[def.requiredLevels.length - 1] ?? 1;
    if (h.level < req) return false;
    h.skillLevels[abilityId] = cur + 1;
    h.skillPoints--;
    if (def.values.charges && cur === 0) h.charges[abilityId] = levelValue(def, 'charges', 1);
    return true;
  }

  registerAbility(impl: AbilityImpl): void {
    this.impls.set(impl.id, impl);
  }

  setPathFinder(_pf: PathFinder): void {
    // Toy sim walks in straight lines.
  }

  buyItem(unitId: number, itemId: string): { ok: true } | { ok: false; reason: string } {
    const u = this.byId.get(unitId);
    const item = ITEMS[itemId];
    if (!u?.hero || !item) return { ok: false, reason: 'Unknown item' };
    const h = u.hero;
    if (!this.nearShop(u, item.shop)) {
      return { ok: false, reason: item.shop === 'secret' ? 'Not near the Secret Shop' : item.shop === 'side' ? 'Not near a side shop' : 'Not near your base shop' };
    }
    const gold = h.reliableGold + h.unreliableGold;
    if (gold < item.cost) return { ok: false, reason: `Not enough gold (${item.cost - Math.floor(gold)} more)` };
    const slot = h.items.indexOf(null);
    // A purchase that completes a recipe can still go through with a full inventory.
    const completes = this.completesRecipe(h.items, itemId);
    if (slot < 0 && !completes) return { ok: false, reason: 'Inventory is full' };
    this.spend(u, item.cost, 'purchase');
    if (slot >= 0) h.items[slot] = itemId;
    else h.items.push(itemId);
    this.combine(h);
    this.events.emit('item:bought', { unitId, itemId });
    return { ok: true };
  }

  buyback(unitId: number): boolean {
    const u = this.byId.get(unitId);
    if (!u?.hero || u.alive || u.hero.respawnAt === null) return false;
    const cost = buybackCost(u.hero.level, this.time);
    if (u.hero.reliableGold + u.hero.unreliableGold < cost) return false;
    this.spend(u, cost, 'buyback');
    this.respawn(u);
    return true;
  }

  // --- Fake-only: stepping and scripting -------------------------------------------------------------

  step(dt: number = SIM_DT): void {
    if (this.frozen) return;
    for (const u of this.list) {
      u.prevPosition.x = u.position.x;
      u.prevPosition.y = u.position.y;
      u.prevPosition.z = u.position.z;
    }
    const prevTime = this.time;
    this.time += dt;
    if (prevTime < 0 && this.time >= 0) this.events.emit('announce', { text: 'The battle has begun!', team: null });

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (p.at <= this.time) {
        this.pending.splice(i, 1);
        p.run();
      }
    }

    for (const u of this.list) {
      u.buffs = u.buffs.filter((b) => b.expiresAt > this.time);
      if (!u.alive) {
        if (u.hero?.respawnAt !== null && u.hero && this.time >= u.hero.respawnAt) this.respawn(u);
        continue;
      }
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + this.stats(u.id).hpRegen * dt);
      if (u.mana < u.maxMana) u.mana = Math.min(u.maxMana, u.mana + Math.max(0.6, u.def.manaRegen) * dt);
      if (u.hero) this.tickCharges(u.hero);
    }

    if (this.time >= this.passiveGoldAt) {
      this.passiveGoldAt = this.time + GOLD.passiveGoldInterval;
      if (this.time >= 0) for (const u of this.list) if (u.hero) u.hero.unreliableGold += GOLD.passiveGoldAmount;
    }

    if (this.demo) {
      this.tickCreeps(dt);
      if (this.time >= this.nextWaveAt) {
        this.nextWaveAt = this.time + 30;
        this.spawnWave();
      }
      if (this.time >= this.nextScriptAt) {
        this.nextScriptAt = this.time + this.rng.range(3.5, 7);
        this.randomScript();
      }
    }
    this.refreshVisibility();
  }

  /** Hero kill with all the bookkeeping the HUD reads (K/D/A, streaks, announces). */
  scriptHeroKill(killerId: number | null, victimId: number, headshot = false): void {
    const v = this.byId.get(victimId);
    if (!v || !v.alive) return;
    if (killerId !== null) {
      this.events.emit('unit:damaged', { targetId: victimId, sourceId: killerId, amount: Math.max(1, v.hp), headshot });
    }
    v.hp = 0;
    this.kill(v, killerId);
  }

  /** Damage a unit as if `sourceId` shot it (damage numbers, hitmarkers). */
  scriptHit(sourceId: number, targetId: number, amount: number, headshot = false): void {
    this.dealDamage({ sourceId, targetId, amount, type: 'physical', isAttack: false, headshot });
  }

  addGold(unitId: number, delta: number, reason = 'script', reliable = false): void {
    const h = this.byId.get(unitId)?.hero;
    if (!h) return;
    if (reliable) h.reliableGold += delta;
    else h.unreliableGold += delta;
    this.events.emit('gold:changed', { unitId, gold: h.reliableGold + h.unreliableGold, delta, reason });
  }

  addXp(unitId: number, xp: number): void {
    const h = this.byId.get(unitId)?.hero;
    if (!h) return;
    h.xp += xp;
    const lvl = Math.min(HERO_XP.maxLevel, heroLevelFromXp(h.xp));
    while (h.level < lvl) {
      h.level++;
      h.skillPoints++;
      const u = this.byId.get(unitId)!;
      const s = heroStatsAtLevel(h.def, h.level);
      const hpFrac = u.hp / u.maxHp;
      u.maxHp = s.hp;
      u.hp = s.hp * hpFrac;
      u.maxMana = s.mana;
      this.events.emit('hero:levelUp', { unitId, level: h.level });
    }
  }

  /** Puts the hero at a level with skills learned in Sniper's usual order (Shrapnel, Headshot, Take Aim, ult). */
  setLevel(unitId: number, level: number, learnAll = true): void {
    const u = this.byId.get(unitId);
    const h = u?.hero;
    if (!u || !h) return;
    h.level = level;
    h.xp = HERO_XP.totalXpForLevel[level - 1] ?? h.xp;
    const s = heroStatsAtLevel(h.def, level);
    u.maxHp = s.hp;
    u.hp = s.hp;
    u.maxMana = s.mana;
    u.mana = s.mana;
    h.skillPoints = level;
    h.skillLevels = {};
    if (!learnAll) return;
    const order = [...h.def.skills];
    let progress = true;
    while (h.skillPoints > 0 && progress) {
      progress = false;
      for (const id of [order[3]!, order[0]!, order[1]!, order[2]!]) {
        if (h.skillPoints > 0 && this.learnAbility(unitId, id)) progress = true;
      }
    }
  }

  killPlayer(killerId: number | null): void {
    this.scriptHeroKill(killerId, this.playerId);
  }

  endMatch(winner: Team): void {
    if (this.ended) return;
    this.ended = true;
    const loser: Team = winner === 'sentinel' ? 'scourge' : 'sentinel';
    const ancient = this.list.find((u) => u.kind === 'ancient' && u.team === loser);
    if (ancient && ancient.alive) {
      ancient.hp = 0;
      this.kill(ancient, null);
    }
    this.events.emit('match:ended', { winner });
  }

  heroes(team?: Team): UnitState[] {
    return this.list.filter((u) => u.hero && (!team || u.team === team));
  }

  // --- internals --------------------------------------------------------------------------------------

  private later(delay: number, run: () => void): void {
    this.pending.push({ at: this.time + delay, run });
  }

  private armorOf(u: UnitState): number {
    return u.hero ? heroStatsAtLevel(u.hero.def, u.hero.level).armor : u.def.armor;
  }

  private addUnit(def: UnitDef, team: Team, x: number, y: number, extra: { lane?: Lane; tier?: Tier; facing?: number; entityId?: number } = {}): UnitState {
    const z = groundHeightAt(this.map, x, y);
    const u: UnitState = {
      id: this.nextId++,
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
    this.list.push(u);
    this.byId.set(u.id, u);
    this.events.emit('unit:spawned', { unitId: u.id });
    return u;
  }

  private spawnHero(defId: string, team: Team, x: number, y: number, isPlayer = false): UnitState {
    const def: HeroDef | undefined = HEROES[defId];
    if (!def) throw new Error(`unknown hero ${defId}`);
    const u = this.addUnit(def, team, x, y);
    u.hero = {
      def,
      level: 1,
      xp: 0,
      skillPoints: 1,
      skillLevels: {},
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
      isPlayer,
    };
    return u;
  }

  private spawnBuildings(): void {
    for (const e of this.map.data.entities) {
      if (e.team === 'neutral') continue;
      let defId: string | null = null;
      if (e.kind === 'tower' && e.tier) defId = `${e.team}_tower_t${e.tier}`;
      else if (e.kind === 'barracks_melee' || e.kind === 'barracks_ranged' || e.kind === 'ancient' || e.kind === 'fountain') defId = `${e.team}_${e.kind}`;
      const def = defId ? UNITS[defId] : undefined;
      if (!def) continue;
      this.addUnit(def, e.team, e.x, e.y, { lane: e.lane, tier: e.tier, facing: e.facing, entityId: e.id });
    }
  }

  private spawnNeutrals(): void {
    const camps = this.map.data.entities.filter((e) => e.kind === 'neutral_camp').slice(0, 6);
    const ids = ['neutral_kobold', 'neutral_forest_troll_berserker', 'neutral_ghost', 'neutral_harpy_scout'].filter((id) => UNITS[id]);
    camps.forEach((c, i) => {
      for (let k = 0; k < 2; k++) this.addUnit(UNITS[ids[(i + k) % ids.length]!]!, 'neutral', c.x + k * 60, c.y);
    });
  }

  private lanePoint(lane: Lane, t: number, team: Team): Vec2 {
    const pts = this.map.data.lanes[lane];
    const idx = Math.min(pts.length - 1, Math.floor((team === 'sentinel' ? t : 1 - t) * (pts.length - 1)));
    return pts[idx]!;
  }

  private offsetFront(along: number, side: number): Vec2 {
    const d = this.frontDir;
    return { x: this.front.x + d.x * along - d.y * side, y: this.front.y + d.y * along + d.x * side };
  }

  private spawnWave(): void {
    for (const team of ['sentinel', 'scourge'] as const) {
      const sign = team === 'sentinel' ? -1 : 1;
      const kinds = ['creep_melee', 'creep_melee', 'creep_melee', 'creep_ranged'];
      kinds.forEach((k, i) => {
        const def = UNITS[`${team}_${k}`];
        if (!def) return;
        const p = this.offsetFront(sign * (650 + (k === 'creep_ranged' ? 120 : 0) + i * 25), (i - 1.5) * 70);
        const u = this.addUnit(def, team, p.x, p.y, { lane: 'mid' });
        u.order = { type: 'attackMove', x: this.front.x, y: this.front.y };
      });
    }
  }

  private tickCreeps(dt: number): void {
    for (const u of this.list) {
      if (!u.alive || (u.kind !== 'creep_melee' && u.kind !== 'creep_ranged' && u.kind !== 'creep_siege')) continue;
      let target: UnitState | null = null;
      let best = Infinity;
      for (const o of this.list) {
        if (!o.alive || o.team === u.team || o.team === 'neutral' || o.hero?.isPlayer) continue;
        if (BUILDING_KINDS.has(o.kind)) continue;
        const d = Math.hypot(o.position.x - u.position.x, o.position.y - u.position.y);
        if (d < best) {
          best = d;
          target = o;
        }
      }
      const range = u.kind === 'creep_ranged' ? 500 : 110;
      if (target && best <= range) {
        u.anim = 'attack';
        const ready = this.attackReadyAt.get(u.id) ?? 0;
        if (this.time >= ready) {
          this.attackReadyAt.set(u.id, this.time + u.def.attackCooldown);
          this.events.emit('unit:attack', { sourceId: u.id, targetId: target.id });
          const t = target;
          const dmg = this.rng.range(u.def.damageMin, u.def.damageMax);
          this.later(u.def.attackPoint, () => {
            if (u.alive && t.alive) this.dealDamage({ sourceId: u.id, targetId: t.id, amount: dmg, type: 'physical', isAttack: true });
          });
        }
      } else {
        const goal = target ? target.position : this.front;
        const dx = goal.x - u.position.x;
        const dy = goal.y - u.position.y;
        const len = Math.hypot(dx, dy);
        if (len > 40) {
          const step = Math.min(len, u.def.moveSpeed * dt * 0.6);
          u.position.x += (dx / len) * step;
          u.position.y += (dy / len) * step;
          u.position.z = groundHeightAt(this.map, u.position.x, u.position.y);
          u.facing = Math.atan2(dy, dx);
          u.anim = 'walk';
        } else u.anim = 'idle';
      }
    }
    // Keep the toy fight from growing forever.
    const creeps = this.list.filter((u) => u.alive && u.kind.startsWith('creep_'));
    if (creeps.length > 40) for (const c of creeps.slice(0, creeps.length - 40)) c.alive = false;
  }

  private randomScript(): void {
    const player = this.player();
    const roll = this.rng.next();
    const visibleEnemies = this.list.filter((u) => u.alive && u.team === 'scourge' && !BUILDING_KINDS.has(u.kind) && this.isVisibleTo('sentinel', u.id));
    if (roll < 0.35 && visibleEnemies.length && player.alive) {
      const t = visibleEnemies[this.rng.int(0, visibleEnemies.length - 1)]!;
      const head = this.rng.chance(0.4);
      this.scriptHit(player.id, t.id, this.rng.range(40, 70), head);
      return;
    }
    if (roll < 0.6) {
      const alive = (team: Team): UnitState[] => this.heroes(team).filter((h) => h.alive && !h.hero!.isPlayer);
      const sentinel = alive('sentinel');
      const scourge = alive('scourge');
      const sentinelKills = this.rng.chance(0.55);
      const killers = sentinelKills ? [player, ...sentinel].filter((h) => h.alive) : scourge;
      const victims = sentinelKills ? scourge : sentinel;
      if (killers.length && victims.length) {
        const k = killers[this.rng.int(0, killers.length - 1)]!;
        this.scriptHeroKill(k.id, victims[this.rng.int(0, victims.length - 1)]!.id, k.id === player.id && this.rng.chance(0.5));
      }
      return;
    }
    if (roll < 0.75) {
      this.addGold(player.id, this.rng.int(38, 48), 'lastHit');
      if (player.hero) player.hero.lastHits++;
      return;
    }
    if (roll < 0.85) {
      const runes = this.map.data.entities.filter((e) => e.kind === 'rune_spot');
      const spot = runes[this.rng.int(0, Math.max(0, runes.length - 1))];
      if (spot) {
        const kind = ['haste', 'doubleDamage', 'illusion', 'regeneration', 'invisibility', 'bounty'][this.rng.int(0, 5)]!;
        this.events.emit('rune:spawned', { runeId: this.nextId++, kind, x: spot.x, y: spot.y });
      }
      return;
    }
    this.addXp(player.id, 120);
  }

  private tickCharges(h: HeroState): void {
    for (const id of Object.keys(h.charges)) {
      const def = ABILITIES[id];
      const lvl = h.skillLevels[id] ?? 0;
      if (!def || lvl <= 0) continue;
      const max = levelValue(def, 'charges', lvl);
      const readyAt = h.cooldownReadyAt[id];
      if ((h.charges[id] ?? 0) < max && readyAt !== undefined && this.time >= readyAt) {
        h.charges[id] = (h.charges[id] ?? 0) + 1;
        h.cooldownReadyAt[id] = (h.charges[id] ?? 0) < max ? this.time + levelValue(def, 'chargeRestoreTime', lvl) : this.time;
      }
    }
  }

  private nearShop(u: UnitState, shop: 'base' | 'secret' | 'side'): boolean {
    const kinds = shop === 'secret' ? ['secret_shop'] : shop === 'side' ? ['side_shop'] : ['shop', 'side_shop'];
    return this.map.data.entities.some(
      (e) =>
        kinds.includes(e.kind) &&
        (e.kind !== 'shop' || e.team === u.team) &&
        Math.hypot(e.x - u.position.x, e.y - u.position.y) <= FAKE_SHOP_RANGE,
    );
  }

  private completesRecipe(items: ReadonlyArray<string | null>, itemId: string): boolean {
    const next = [...items, itemId];
    return Object.values(ITEMS).some((it) => it.components?.length && this.hasAll(next, it.components));
  }

  private hasAll(items: ReadonlyArray<string | null>, components: readonly string[]): boolean {
    const pool = items.filter((x): x is string => !!x);
    for (const c of components) {
      const i = pool.indexOf(c);
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  }

  private combine(h: HeroState): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const it of Object.values(ITEMS)) {
        if (!it.components?.length || !this.hasAll(h.items, it.components)) continue;
        for (const c of it.components) h.items[h.items.indexOf(c)] = null;
        const slot = h.items.indexOf(null);
        h.items[slot] = it.id;
        changed = true;
      }
    }
    while (h.items.length > 6) {
      const i = h.items.indexOf(null);
      if (i < 0) break;
      h.items.splice(i, 1);
    }
    while (h.items.length < 6) h.items.push(null);
  }

  private spend(u: UnitState, cost: number, reason: string): void {
    const h = u.hero!;
    const fromUnreliable = Math.min(h.unreliableGold, cost);
    h.unreliableGold -= fromUnreliable;
    h.reliableGold -= cost - fromUnreliable;
    this.events.emit('gold:changed', { unitId: u.id, gold: h.reliableGold + h.unreliableGold, delta: -cost, reason });
  }

  private respawn(u: UnitState): void {
    if (!u.hero) return;
    u.alive = true;
    u.hp = u.maxHp;
    u.mana = u.maxMana;
    u.hero.respawnAt = null;
    u.anim = 'idle';
    this.events.emit('unit:spawned', { unitId: u.id });
  }

  private kill(v: UnitState, killerId: number | null): void {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.anim = 'death';
    const killer = killerId !== null ? this.byId.get(killerId) : undefined;
    const denied = !!killer && killer.team === v.team;
    this.events.emit('unit:died', { unitId: v.id, killerId, denied });
    if (BUILDING_KINDS.has(v.kind)) this.events.emit('building:destroyed', { unitId: v.id, entityId: v.entityId ?? null });
    if (v.kind === 'tower' && !denied) {
      const t = killer?.team ?? (v.team === 'sentinel' ? 'scourge' : 'sentinel');
      this.events.emit('announce', { text: `The ${t === 'sentinel' ? 'Sentinel' : 'Scourge'} destroyed a tower!`, team: t });
    }
    if (killer?.hero && !v.hero && !denied && v.team !== 'neutral') {
      killer.hero.lastHits++;
      const bounty = Math.round(this.rng.range(v.def.bountyGoldMin, v.def.bountyGoldMax));
      if (killer.hero.isPlayer) this.addGold(killer.id, bounty, 'lastHit');
      else killer.hero.unreliableGold += bounty;
    }
    if (killer?.hero && denied && !v.hero) killer.hero.denies++;
    if (!v.hero) return;

    // Hero death bookkeeping.
    v.hero.deaths++;
    v.hero.respawnAt = this.time + respawnTime(v.hero.level);
    this.streak.set(v.id, 0);
    const lost = Math.min(v.hero.unreliableGold, GOLD.deathGoldLossPerLevel * v.hero.level);
    v.hero.unreliableGold -= lost;
    if (v.hero.isPlayer && lost > 0) this.events.emit('gold:changed', { unitId: v.id, gold: v.hero.reliableGold + v.hero.unreliableGold, delta: -lost, reason: 'death' });
    if (!killer?.hero || denied) return;
    killer.hero.kills++;
    const bounty = GOLD.heroKillBase + GOLD.heroKillPerVictimLevel * v.hero.level;
    if (killer.hero.isPlayer) this.addGold(killer.id, bounty, 'heroKill', true);
    else killer.hero.reliableGold += bounty;
    for (const a of this.heroes(killer.team)) if (a !== killer && a.alive && this.rng.chance(0.4)) a.hero!.assists++;

    const name = killer.hero.def.name;
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.events.emit('announce', { text: `${name} has drawn First Blood!`, team: killer.team });
    }
    const s = (this.streak.get(killer.id) ?? 0) + 1;
    this.streak.set(killer.id, s);
    const m = this.multi.get(killer.id);
    const count = m && this.time - m.at <= 18 ? m.count + 1 : 1;
    this.multi.set(killer.id, { count, at: this.time });
    if (count >= 2) this.events.emit('announce', { text: `${name}: ${MULTI_TEXT[Math.min(5, count)]!}`, team: killer.team });
    else if (s >= 3) this.events.emit('announce', { text: `${name} ${STREAK_TEXT[Math.min(10, s)]!}`, team: killer.team });
  }

  private refreshVisibility(): void {
    for (const team of ['sentinel', 'scourge'] as const) {
      const set = this.visible[team];
      set.clear();
      const eyes = this.list.filter((u) => u.alive && u.team === team);
      const radii = eyes.map((u) => scaledRange(this.isDay ? u.def.visionDay : u.def.visionNight) * 0.6);
      for (const u of this.list) {
        if (u.team === team || !u.alive) continue;
        for (let i = 0; i < eyes.length; i++) {
          const e = eyes[i]!;
          const r = radii[i]!;
          const dx = e.position.x - u.position.x;
          const dy = e.position.y - u.position.y;
          if (dx * dx + dy * dy <= r * r) {
            set.add(u.id);
            break;
          }
        }
      }
    }
  }
}

export const createFakeSim = (opts: FakeSimOptions): FakeSim => new FakeSim(opts);
