// Lich (6.83d values in src/data/heroes/lich.ts): Frost Nova, Frost Armor, Dark Ritual, Chain Frost.
import type { AbilityImpl, SimApi, UnitState } from '../../core/sim';
import { ABILITIES, levelValue } from '../../data';
import { canAffect, consumeSpellBlock, damageTypeOf, frostSlow, isStructure, spellTargetsAround, sr } from './common';

export const FROST_ARMOR_BUFF = 'lich_frost_armor';

/** Frost Nova: primary target takes the target damage plus the nova; enemies within 200 (scaled) take the nova. */
export const frostNova = (): AbilityImpl => ({
  id: 'lich_frost_nova',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team || consumeSpellBlock(sim, t)) return;
    const type = damageTypeOf(ctx);
    const { x, y } = t.position;
    sim.dealDamage({ sourceId: caster.id, targetId: t.id, amount: ctx.value('targetDamage'), type, isAttack: false, abilityId: ctx.def.id });
    const until = sim.time + ctx.value('slowDuration');
    const area = spellTargetsAround(sim, caster, x, y, sr(ctx.value('radius')));
    if (t.alive && !area.includes(t)) area.push(t);
    for (const u of area) {
      sim.dealDamage({ sourceId: caster.id, targetId: u.id, amount: ctx.value('areaDamage'), type, isAttack: false, abilityId: ctx.def.id });
      if (u.alive) sim.addBuff(u.id, frostSlow(caster.id, until, ctx.value('moveSlow'), ctx.value('attackSlow')));
    }
  },
});

/** Frost Armor: +armor on an ally (or building) for 40 s; units that attack it are frost-slowed for 2 s. */
export const frostArmor = (sim: SimApi): AbilityImpl => {
  const def = ABILITIES['lich_frost_armor']!;
  /** targetId → level of the Frost Armor on it. */
  const levels = new Map<number, number>();
  sim.events.on('unit:attack', ({ sourceId, targetId }) => {
    const t = sim.get(targetId);
    const buff = t?.buffs.find((b) => b.id === FROST_ARMOR_BUFF && b.expiresAt > sim.time);
    const src = sim.get(sourceId);
    if (!buff || !canAffect(src) || isStructure(src) || src.team === t!.team) return;
    const level = levels.get(targetId) ?? 1;
    sim.addBuff(src.id, frostSlow(buff.sourceId ?? targetId, sim.time + levelValue(def, 'attackerSlowDuration', level), levelValue(def, 'moveSlow', level), levelValue(def, 'attackSlow', level)));
  });
  return {
    id: def.id,
    cast(ctx, target) {
      const t = target.targetId !== undefined ? ctx.sim.get(target.targetId) : ctx.caster;
      if (!t?.alive || t.team !== ctx.caster.team) return;
      levels.set(t.id, ctx.level);
      ctx.sim.addBuff(t.id, { id: FROST_ARMOR_BUFF, sourceId: ctx.caster.id, expiresAt: ctx.sim.time + ctx.value('duration'), armor: ctx.value('bonusArmor') });
    },
  };
};

/** Dark Ritual: sacrifices an allied non-hero creep; Lich gains a share of its current HP as mana. */
export const darkRitual = (): AbilityImpl => ({
  id: 'lich_dark_ritual',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!t?.alive || t.team !== caster.team || t.hero || isStructure(t) || t.kind === 'roshan') return;
    const mana = t.hp * ctx.value('hpToManaPct');
    sim.dealDamage({ sourceId: caster.id, targetId: t.id, amount: t.hp + 1, type: 'pure', isAttack: false, abilityId: ctx.def.id });
    sim.restoreMana(caster.id, mana);
  },
});

/**
 * Chain Frost: a frost orb (675/s) that bounces between random enemies within 600 (scaled). "Bounces 10
 * times" is read as 10 jumps after the first hit; it never jumps to the unit it just hit.
 */
export const chainFrost = (): AbilityImpl => ({
  id: 'lich_chain_frost',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const first = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(first) || first.team === caster.team) return;
    const damage = ctx.value('damage');
    const type = damageTypeOf(ctx);
    const speed = ctx.value('projectileSpeed');
    const bounceRange = sr(ctx.value('bounceRange'));
    const slowFor = ctx.value('slowDuration');
    const move = ctx.value('moveSlow');
    const attack = ctx.value('attackSlow');
    const casterId = caster.id;
    const casterTeam = caster.team;
    const jump = (fromId: number, to: UnitState, remaining: number): void => {
      sim.launchProjectile({
        sourceId: fromId,
        targetId: to.id,
        speed,
        visual: 'chain_frost',
        onHit: (s) => {
          const hit = s.get(to.id);
          if (canAffect(hit) && !consumeSpellBlock(s, hit)) {
            s.dealDamage({ sourceId: casterId, targetId: hit.id, amount: damage, type, isAttack: false, abilityId: 'lich_chain_frost' });
            if (hit.alive) s.addBuff(hit.id, frostSlow(casterId, s.time + slowFor, move, attack));
          }
          if (remaining <= 0 || !hit) return;
          const options = s
            .query(hit.position.x, hit.position.y, bounceRange, { notTeam: casterTeam, aliveOnly: true, visibleTo: casterTeam })
            .filter((u) => u.id !== hit.id && u.team !== casterTeam && !isStructure(u) && canAffect(u));
          if (options.length === 0) return;
          const next = options[Math.min(options.length - 1, Math.floor(s.rng.next() * options.length))]!;
          jump(hit.id, next, remaining - 1);
        },
      });
    };
    jump(casterId, first, ctx.value('bounces'));
  },
});

export const lichAbilities = (sim: SimApi): AbilityImpl[] => [frostNova(), frostArmor(sim), darkRitual(), chainFrost()];
