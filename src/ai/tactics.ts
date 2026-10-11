// Per-hero spell tactics for bots: when to cast what in fights, in lane and while escaping.
import type { Rng } from '../core/rng';
import type { CastTarget, SimApi, UnitState } from '../core/sim';
import type { Vec2 } from '../core/types';
import { chooseRaze, hasBuff, isStunned, isToggledOn, razeDistances, razeReady, setPoisonAutocast, sr, stacksOf, SOULS_KEY } from './abilities';
import { distToSegment } from './aim';
import type { DifficultyParams } from './difficulty';
import type { Perception } from './perception';

/** What tactics see of the bot (implemented by BotController). */
export interface BotCtx {
  readonly sim: SimApi;
  readonly self: UnitState;
  readonly params: DifficultyParams;
  readonly rng: Rng;
  readonly perception: Perception;
  /** Learned level (0 = not learned). */
  level(id: string): number;
  /** Learned, off cooldown, affordable and the bot can cast right now. */
  ready(id: string): boolean;
  /** Per-level ability value at the learned level. */
  value(id: string, key: string): number;
  /** Cast range, already scaled. */
  range(id: string): number;
  /** Starts a cast (walks closer when out of range). True if the cast started. */
  cast(id: string, target: CastTarget): boolean;
  /** Skillshot aim point at an enemy hero (delayed perception + lead + humanised error). */
  aim(target: UnitState, speed: number, delay: number): Vec2;
  /** Where the bot believes the hero will be after `seconds` (delayed perception + partial lead). */
  predict(target: UnitState, seconds: number): Vec2;
  dist(p: Vec2): number;
  /** Enemy heroes the bot knows about within radius (visible + reaction-delayed). */
  knownEnemyHeroes(radius: number): UnitState[];
  /** Visible enemy units around a point (creeps, heroes, neutrals; no structures). */
  enemyUnits(x: number, y: number, radius: number): UnitState[];
  alliedUnits(x: number, y: number, radius: number): UnitState[];
}

export interface HeroTactics {
  /** Spell damage the bot could unload on the target right now (pre-resistance). */
  burst(c: BotCtx, t: UnitState): number;
  /** One spell action in a fight; true if a cast was issued. */
  fight(c: BotCtx, t: UnitState): boolean;
  /** Opportunistic spell while laning; true if a cast was issued. */
  lane(c: BotCtx): boolean;
  /** Defensive spell against a chaser while retreating. */
  escape(c: BotCtx, chaser: UnitState): boolean;
  /** Toggles / autocasts, every think. */
  maintain(c: BotCtx): void;
}

const hpFrac = (u: UnitState): number => u.hp / Math.max(1, u.maxHp);
const disabled = (u: UnitState): boolean => isStunned(u) || u.buffs.some((b) => b.silenced && b.damagePct === -1);
/** Mana left after paying `cost` is at least `frac` of max mana (keeps mana for the fight combo). */
const affordable = (c: BotCtx, id: string, frac: number): boolean => c.self.mana - c.value(id, 'manaCost') >= frac * c.self.maxMana;

/** True if no other unit stands between the caster and `to` within `width` (hook / line blockers). */
const lineClear = (c: BotCtx, to: Vec2, width: number, ignoreId: number): boolean => {
  const from = c.self.position;
  const len = c.dist(to);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  for (const u of c.sim.query(mid.x, mid.y, len / 2 + width + 50, { aliveOnly: true })) {
    if (u.id === c.self.id || u.id === ignoreId || u.kind === 'tower' || u.kind === 'fountain' || u.kind === 'building') continue;
    if (u.kind.startsWith('barracks') || u.kind === 'ancient') continue;
    if (distToSegment(u.position, from, to) <= width + u.def.collisionRadius) return false;
  }
  return true;
};

const GENERIC: HeroTactics = {
  burst: () => 0,
  fight: () => false,
  lane: () => false,
  escape: () => false,
  maintain: () => undefined,
};

const pudge: HeroTactics = {
  burst(c, t) {
    let d = 0;
    if (c.ready('pudge_meat_hook')) d += c.value('pudge_meat_hook', 'damage');
    if (c.ready('pudge_dismember')) d += c.value('pudge_dismember', 'damagePerSecond') * (t.hero ? c.value('pudge_dismember', 'heroDuration') : 3);
    if (c.level('pudge_rot') > 0) d += c.value('pudge_rot', 'damagePerSecond') * 2;
    return d;
  },
  fight(c, t) {
    if (c.ready('pudge_dismember') && c.dist(t.position) <= c.range('pudge_dismember') + 150) return c.cast('pudge_dismember', { targetId: t.id });
    return hook(c, t, 0.95);
  },
  lane(c) {
    if (!c.params.laneSpells || !c.ready('pudge_meat_hook')) return false;
    const t = c.knownEnemyHeroes(sr(1300)).find((h) => hpFrac(h) < 0.6 || affordable(c, 'pudge_meat_hook', 0.45));
    return !!t && c.rng.chance(0.5) && hook(c, t, 0.85);
  },
  escape: () => false,
  maintain(c) {
    if (c.level('pudge_rot') <= 0) return;
    const on = isToggledOn(c.sim, c.self.id, 'pudge_rot');
    const want = hpFrac(c.self) > 0.25 && c.knownEnemyHeroes(sr(c.value('pudge_rot', 'radius')) + 60).length > 0;
    if (on !== want) c.cast('pudge_rot', {});
  },
};

/** Meat Hook at a known hero if the (predicted) line is clear of other units. */
const hook = (c: BotCtx, t: UnitState, rangeFrac: number): boolean => {
  if (!c.ready('pudge_meat_hook')) return false;
  const reach = sr(c.value('pudge_meat_hook', 'maxLinks') * c.value('pudge_meat_hook', 'linkLength'));
  const speed = c.value('pudge_meat_hook', 'linkLength') / c.value('pudge_meat_hook', 'extendInterval');
  const p = c.aim(t, speed, 0.3);
  if (c.dist(p) > reach * rangeFrac) return false;
  if (!lineClear(c, p, c.value('pudge_meat_hook', 'hitRadius'), t.id)) return false;
  return c.cast('pudge_meat_hook', { point: p });
};

const lion: HeroTactics = {
  burst(c, t) {
    let d = 0;
    if (c.ready('lion_impale')) d += c.value('lion_impale', 'damage');
    if (c.ready('lion_finger_of_death')) d += c.value('lion_finger_of_death', 'damage');
    return d + (c.ready('lion_voodoo') ? 0.15 * t.maxHp : 0);
  },
  fight(c, t) {
    const finger = c.ready('lion_finger_of_death') ? c.value('lion_finger_of_death', 'damage') * (1 - t.def.magicResistance) : 0;
    if (finger > 0 && (t.hp <= finger * 1.05 || (c.params.combos && disabled(t) && hpFrac(t) < 0.75))) {
      if (c.dist(t.position) <= c.range('lion_finger_of_death') + 200) return c.cast('lion_finger_of_death', { targetId: t.id });
    }
    if (!disabled(t)) {
      if (c.ready('lion_impale') && impale(c, t)) return true;
      if (c.ready('lion_voodoo') && c.dist(t.position) <= c.range('lion_voodoo') + 150) return c.cast('lion_voodoo', { targetId: t.id });
    }
    if (finger > 0 && c.params.combos && c.dist(t.position) <= c.range('lion_finger_of_death')) return c.cast('lion_finger_of_death', { targetId: t.id });
    return false;
  },
  lane(c) {
    if (!c.params.laneSpells) return false;
    const t = c.knownEnemyHeroes(sr(1100))[0];
    if (t && c.ready('lion_impale') && affordable(c, 'lion_impale', 0.5) && c.rng.chance(0.4) && impale(c, t)) return true;
    if (t && c.ready('lion_mana_drain') && hpFrac(c.self) > 0.6 && c.self.mana < 0.4 * c.self.maxMana && t.mana > 50 && c.dist(t.position) <= c.range('lion_mana_drain')) {
      return c.cast('lion_mana_drain', { targetId: t.id });
    }
    return false;
  },
  escape(c, chaser) {
    if (c.ready('lion_voodoo') && c.dist(chaser.position) <= c.range('lion_voodoo')) return c.cast('lion_voodoo', { targetId: chaser.id });
    return c.ready('lion_impale') && impale(c, chaser);
  },
  maintain: () => undefined,
};

const impale = (c: BotCtx, t: UnitState): boolean => {
  const travel = sr(c.value('lion_impale', 'travelDistance'));
  const p = c.aim(t, c.value('lion_impale', 'travelSpeed'), 0.3);
  if (c.dist(p) > travel * 0.95) return false;
  // The spike always runs its full length; keep the clicked point inside the cast range.
  const d = Math.max(1, c.dist(p));
  const k = Math.min(1, c.range('lion_impale') / d);
  const s = c.self.position;
  return c.cast('lion_impale', { point: { x: s.x + (p.x - s.x) * k, y: s.y + (p.y - s.y) * k } });
};

const viper: HeroTactics = {
  burst(c) {
    return c.ready('viper_strike') ? c.value('viper_strike', 'damagePerSecond') * c.value('viper_strike', 'duration') : 0;
  },
  fight(c, t) {
    if (c.ready('viper_strike') && (hpFrac(t) < 0.85 || c.params.combos) && c.dist(t.position) <= c.range('viper_strike') + 200) {
      return c.cast('viper_strike', { targetId: t.id });
    }
    return false;
  },
  lane: () => false,
  escape: () => false,
  maintain(c) {
    if (c.level('viper_poison_attack') > 0) setPoisonAutocast(c.sim, c.self.id, c.self.mana > 0.25 * c.self.maxMana);
  },
};

/** Fires the raze whose blast centre covers where the target will be after the cast point. */
const raze = (c: BotCtx, t: UnitState): boolean => {
  if (!c.ready('sf_shadowraze')) return false;
  const lvl = c.level('sf_shadowraze');
  const p = c.predict(t, 0.67);
  const d = c.dist(p);
  const radius = sr(c.value('sf_shadowraze', 'radius'));
  const dists = razeDistances(lvl);
  let pick = -1;
  let err = Infinity;
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(d - dists[i]!);
    if (razeReady(c.sim, c.self.id, i) && e < radius * 0.7 && e < err) {
      err = e;
      pick = i;
    }
  }
  if (pick < 0) return false;
  chooseRaze(c.sim, c.self.id, pick);
  return c.cast('sf_shadowraze', { point: p });
};

const shadowFiend: HeroTactics = {
  burst(c) {
    let d = 0;
    if (c.ready('sf_shadowraze')) d += c.value('sf_shadowraze', 'damage') * [0, 1, 2].filter((i) => razeReady(c.sim, c.self.id, i)).length;
    if (c.ready('sf_requiem_of_souls')) d += c.value('sf_requiem_of_souls', 'damagePerLine') * Math.min(6, Math.floor(stacksOf(c.sim, c.self.id, SOULS_KEY) / 2));
    return d;
  },
  fight(c, t) {
    const souls = stacksOf(c.sim, c.self.id, SOULS_KEY);
    if (c.ready('sf_requiem_of_souls') && souls >= 10 && c.dist(t.position) < sr(300) && (hpFrac(t) < 0.8 || c.knownEnemyHeroes(sr(400)).length > 1)) {
      return c.cast('sf_requiem_of_souls', {});
    }
    return raze(c, t);
  },
  lane(c) {
    if (!c.params.laneSpells || !c.ready('sf_shadowraze') || !affordable(c, 'sf_shadowraze', 0.45)) return false;
    const t = c.knownEnemyHeroes(sr(800))[0];
    return !!t && c.rng.chance(0.5) && raze(c, t);
  },
  escape: () => false,
  maintain: () => undefined,
};

const lich: HeroTactics = {
  burst(c, t) {
    let d = 0;
    if (c.ready('lich_frost_nova')) d += c.value('lich_frost_nova', 'targetDamage') + c.value('lich_frost_nova', 'areaDamage');
    if (c.ready('lich_chain_frost')) d += c.value('lich_chain_frost', 'damage') * (t.hero ? 2 : 1);
    return d;
  },
  fight(c, t) {
    if (c.ready('lich_chain_frost') && (hpFrac(t) < 0.6 || c.params.combos) && c.dist(t.position) <= c.range('lich_chain_frost') + 200) {
      return c.cast('lich_chain_frost', { targetId: t.id });
    }
    if (c.ready('lich_frost_nova') && c.dist(t.position) <= c.range('lich_frost_nova') + 200) return c.cast('lich_frost_nova', { targetId: t.id });
    return false;
  },
  lane(c) {
    if (c.ready('lich_dark_ritual') && c.self.mana < 0.6 * c.self.maxMana) {
      const creep = c
        .alliedUnits(c.self.position.x, c.self.position.y, c.range('lich_dark_ritual') + 300)
        .filter((u) => u.kind === 'creep_ranged' || u.kind === 'creep_melee')
        .sort((a, b) => b.hp - a.hp)[0];
      if (creep && hpFrac(creep) > 0.8) return c.cast('lich_dark_ritual', { targetId: creep.id });
    }
    if (!c.params.laneSpells) return false;
    const t = c.knownEnemyHeroes(c.range('lich_frost_nova') + 100)[0];
    if (t && c.ready('lich_frost_nova') && affordable(c, 'lich_frost_nova', 0.45) && c.rng.chance(0.5)) return c.cast('lich_frost_nova', { targetId: t.id });
    return false;
  },
  escape(c, chaser) {
    if (c.ready('lich_frost_nova') && c.dist(chaser.position) <= c.range('lich_frost_nova')) return c.cast('lich_frost_nova', { targetId: chaser.id });
    return false;
  },
  maintain(c) {
    if (!c.ready('lich_frost_armor') || hasBuff(c.self, 'lich_frost_armor')) return;
    if (c.knownEnemyHeroes(sr(900)).length > 0 || c.enemyUnits(c.self.position.x, c.self.position.y, sr(400)).length > 2) {
      c.cast('lich_frost_armor', { targetId: c.self.id });
    }
  },
};

export const TACTICS: Record<string, HeroTactics> = {
  pudge,
  lion,
  viper,
  shadow_fiend: shadowFiend,
  lich,
};

export const tacticsFor = (heroId: string): HeroTactics => TACTICS[heroId] ?? GENERIC;
