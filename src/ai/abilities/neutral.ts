// Roshan and neutral creep abilities (src/data/unitAbilities.ts). In 6.83d data only Roshan has
// abilities: every neutral creep def has `abilities: []`, so there are no neutral auras/actives to run.
import type { AbilityContext, AbilityImpl, SimApi, UnitState } from '../../core/sim';
import { levelValue } from '../../data';
import { canAffect, isStructure, kitState, spellTargetsAround, sr } from './common';

export const ROSHAN_BASH_BUFF = 'roshan_bash';
export const ROSHAN_SLAM_BUFF = 'roshan_slam';
export const ROSHAN_ARMOR_BUFF = 'roshan_armor_growth';

/** Bash: 15% per attack, +50 damage and a 1.65 s stun. */
export const roshanBash = (): AbilityImpl => ({
  id: 'roshan_bash',
  onAttack(ctx, req) {
    const { sim, caster } = ctx;
    const t = sim.get(req.targetId);
    if (!t?.alive || isStructure(t) || !sim.rng.chance(ctx.value('chance'))) return;
    req.amount += ctx.value('bonusDamage');
    sim.addBuff(t.id, { id: ROSHAN_BASH_BUFF, sourceId: caster.id, expiresAt: sim.time + ctx.value('stunDuration'), stunned: true });
  },
});

/** Slam level = 1 + floor(time / 240), capped at the data's 15 levels. */
export const slamLevel = (time: number, ctx: AbilityContext): number =>
  Math.min(ctx.def.maxLevel, 1 + Math.floor(Math.max(0, time) / levelValue(ctx.def, 'levelUpInterval', 1)));

const applySlam = (ctx: AbilityContext, roshan: UnitState): void => {
  const { sim } = ctx;
  const level = slamLevel(sim.time, ctx);
  const damage = levelValue(ctx.def, 'damage', level);
  for (const u of spellTargetsAround(sim, roshan, roshan.position.x, roshan.position.y, sr(levelValue(ctx.def, 'radius', level)))) {
    sim.dealDamage({ sourceId: roshan.id, targetId: u.id, amount: damage, type: 'magical', isAttack: false, abilityId: ctx.def.id });
    if (!u.alive) continue;
    const dur = levelValue(ctx.def, u.hero ? 'heroDuration' : 'duration', level);
    sim.addBuff(u.id, {
      id: ROSHAN_SLAM_BUFF,
      sourceId: roshan.id,
      expiresAt: sim.time + dur,
      moveSpeedPct: -levelValue(ctx.def, 'moveSlow', level),
      attackSpeed: -levelValue(ctx.def, 'attackSlow', level),
    });
  }
};

/**
 * Slam: Roshan has no brain, so the ability's tick casts it whenever enemies stand in its radius and
 * it's off cooldown. Falls back to an instant slam if the sim refuses non-hero casts.
 */
export const roshanSlam = (): AbilityImpl => ({
  id: 'roshan_slam',
  cast(ctx) {
    kitState(ctx.sim).slamReadyAt.set(ctx.caster.id, ctx.sim.time + ctx.value('cooldown'));
    applySlam(ctx, ctx.caster);
  },
  tick(ctx) {
    const { sim, caster } = ctx;
    const s = kitState(sim);
    if ((s.slamReadyAt.get(caster.id) ?? -Infinity) > sim.time) return;
    const enemies = spellTargetsAround(sim, caster, caster.position.x, caster.position.y, sr(ctx.value('radius')));
    if (!enemies.some((u) => canAffect(u))) return;
    // Mark busy for the cast point so we don't re-issue the cast every tick; cast() sets the real cooldown.
    s.slamReadyAt.set(caster.id, sim.time + ctx.def.castPoint + 0.1);
    const res = sim.castAbility(caster.id, ctx.def.id, {});
    if (!res.ok && res.reason !== 'cooldown') {
      s.slamReadyAt.set(caster.id, sim.time + ctx.value('cooldown'));
      applySlam(ctx, caster);
    }
  },
});

/** Spell Block is enforced by the unit-target spells via consumeSpellBlock(); nothing to tick. */
export const roshanSpellBlock = (): AbilityImpl => ({ id: 'roshan_spell_block' });

/** Spell damage reduction is ROSHAN.magicResistance (0.75), applied by the sim's damage formula. */
export const roshanSpellResistance = (): AbilityImpl => ({ id: 'roshan_spell_resistance' });

/** Armor growth: +0.5 armor per level, level = 1 + floor(time / 300). */
export const roshanArmorGrowth = (): AbilityImpl => ({
  id: 'roshan_armor_growth',
  tick(ctx) {
    const { sim, caster } = ctx;
    const level = Math.min(ctx.def.maxLevel, 1 + Math.floor(Math.max(0, sim.time) / ctx.value('interval')));
    const armor = ctx.value('armorPerLevel') * level;
    const cur = caster.buffs.find((b) => b.id === ROSHAN_ARMOR_BUFF);
    if (cur?.armor === armor) return;
    sim.addBuff(caster.id, { id: ROSHAN_ARMOR_BUFF, sourceId: caster.id, expiresAt: Infinity, armor });
  },
});

export const neutralAbilities = (_sim: SimApi): AbilityImpl[] => [roshanBash(), roshanSlam(), roshanSpellBlock(), roshanSpellResistance(), roshanArmorGrowth()];
