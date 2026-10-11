// Viper (6.83d values in src/data/heroes/viper.ts): Poison Attack, Nethertoxin, Corrosive Skin, Viper Strike.
import type { AbilityContext, AbilityImpl, SimApi, UnitState } from '../../core/sim';
import { ABILITIES, levelValue } from '../../data';
import { canAffect, consumeSpellBlock, isStructure, kitState, toggleKey } from './common';

export const POISON_BUFF = 'viper_poison_attack';
export const CORROSIVE_BUFF = 'viper_corrosive_skin';
export const VIPER_STRIKE_BUFF = 'viper_strike';

/** Poison Attack autocast mode per unit: on = every attack on a hero spends mana and poisons. */
export const setPoisonAutocast = (sim: SimApi, unitId: number, on: boolean): void => {
  kitState(sim).toggles.set(toggleKey(unitId, 'viper_poison_attack'), on);
};

const poison = (ctx: AbilityContext, t: UnitState): void => {
  const { sim, caster } = ctx;
  const slow = ctx.value('moveSlow');
  sim.addBuff(t.id, {
    id: POISON_BUFF,
    sourceId: caster.id,
    expiresAt: sim.time + ctx.value('duration'),
    moveSpeedPct: -slow,
    attackSpeed: -ctx.value('attackSlow'),
    dps: { amount: ctx.value('damagePerSecond'), type: 'magical' },
  });
};

/**
 * Orb attack. Manual cast (mana paid by the sim) arms the next attack and orders it; autocast spends the
 * mana per attack on heroes. Applied in onAttack, i.e. when the attack lands.
 */
export const poisonAttack = (): AbilityImpl => ({
  id: 'viper_poison_attack',
  cast(ctx, target) {
    if (target.targetId === undefined) return;
    kitState(ctx.sim).poisonPending.add(ctx.caster.id);
    ctx.sim.order(ctx.caster.id, { type: 'attack', targetId: target.targetId });
  },
  onAttack(ctx, req) {
    const { sim, caster } = ctx;
    const t = sim.get(req.targetId);
    if (!canAffect(t) || isStructure(t) || t.team === caster.team) return;
    const s = kitState(sim);
    if (s.poisonPending.delete(caster.id)) {
      poison(ctx, t);
      return;
    }
    if (!t.hero || !s.toggles.get(toggleKey(caster.id, ctx.def.id))) return;
    const cost = ctx.value('manaCost');
    if (caster.mana < cost) return;
    caster.mana -= cost;
    poison(ctx, t);
  },
});

/**
 * Nethertoxin: bonus attack damage from min to max as the target loses HP. The data only has min/max
 * (VERIFY #16); this uses DotA's "doubles for every 20% HP missing" bands, which is exactly min·2^4 = max.
 */
export const nethertoxinBonus = (minBonus: number, maxBonus: number, hpFraction: number): number => {
  const band = Math.min(4, Math.max(0, Math.floor((1 - hpFraction) / 0.2 + 1e-9)));
  return Math.min(maxBonus, minBonus * 2 ** band);
};

export const nethertoxin = (): AbilityImpl => ({
  id: 'viper_nethertoxin',
  onAttack(ctx, req) {
    const t = ctx.sim.get(req.targetId);
    if (!t?.alive || isStructure(t) || t.team === ctx.caster.team) return;
    let bonus = nethertoxinBonus(ctx.value('minBonusDamage'), ctx.value('maxBonusDamage'), t.hp / Math.max(1, t.maxHp));
    if (!t.hero) bonus *= ctx.value('nonHeroMultiplier');
    req.amount += bonus;
  },
});

/**
 * Corrosive Skin: units that damage Viper are slowed and poisoned for 4 s. Event-driven (no incoming-damage
 * hook in the contract); the magic damage reduction needs one (CONTRACT_REQUESTS.md G2).
 */
export const corrosiveSkin = (sim: SimApi): AbilityImpl => {
  const def = ABILITIES['viper_corrosive_skin']!;
  sim.events.on('unit:damaged', ({ targetId, sourceId }) => {
    if (sourceId === null || sourceId === targetId) return;
    const viper = sim.get(targetId);
    const src = sim.get(sourceId);
    const level = viper?.hero?.skillLevels[def.id] ?? 0;
    if (!viper?.alive || level <= 0 || !canAffect(src) || isStructure(src) || src.team === viper.team) return;
    if (src.buffs.some((b) => b.id === CORROSIVE_BUFF && b.expiresAt > sim.time + levelValue(def, 'duration', level) - 0.5)) return;
    sim.addBuff(src.id, {
      id: CORROSIVE_BUFF,
      sourceId: viper.id,
      expiresAt: sim.time + levelValue(def, 'duration', level),
      moveSpeedPct: -levelValue(def, 'attackerMoveSlow', level),
      attackSpeed: -levelValue(def, 'attackerAttackSlow', level),
      dps: { amount: levelValue(def, 'attackerDamagePerSecond', level), type: 'magical' },
    });
  });
  return { id: def.id };
};

export const viperStrike = (): AbilityImpl => ({
  id: 'viper_strike',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team) return;
    const duration = ctx.value('duration');
    const dps = ctx.value('damagePerSecond');
    const move = ctx.value('moveSlow');
    const attack = ctx.value('attackSlow');
    sim.launchProjectile({
      sourceId: caster.id,
      targetId: t.id,
      speed: ctx.value('projectileSpeed'),
      visual: 'viper_strike',
      onHit: (s) => {
        const hit = s.get(t.id);
        if (!canAffect(hit) || consumeSpellBlock(s, hit)) return;
        s.addBuff(hit.id, { id: VIPER_STRIKE_BUFF, sourceId: caster.id, expiresAt: s.time + duration, moveSpeedPct: -move, attackSpeed: -attack, dps: { amount: dps, type: 'magical' } });
      },
    });
  },
});

export const viperAbilities = (sim: SimApi): AbilityImpl[] => [poisonAttack(), nethertoxin(), corrosiveSkin(sim), viperStrike()];
