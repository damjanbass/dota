// E Take Aim. In 6.83d a passive +100..400 attack range; in the FPS the scope IS taking aim: the player's hero gets
// the range buff only while scoped (the kit drives it every tick). Bot Snipers keep it permanently.
// The buff carries the UNSCALED bonus; the sim's stats() applies RANGE_SCALE to the total.
import type { AbilityImpl, SimApi } from '../../core/sim';
import { levelValue, SNIPER_TAKE_AIM } from '../../data';
import { BUFF, TAKE_AIM, skillLevel } from './ids';

/** Adds / updates / removes the Take Aim range buff. Returns the unscaled bonus now applied. */
export const applyTakeAim = (sim: SimApi, unitId: number, aiming: boolean): number => {
  const unit = sim.get(unitId);
  if (!unit) return 0;
  const level = skillLevel(unit, TAKE_AIM);
  const bonus = aiming && level > 0 && unit.alive ? levelValue(SNIPER_TAKE_AIM, 'bonusAttackRange', level) : 0;
  const existing = unit.buffs.find((b) => b.id === BUFF.takeAim);
  if (bonus === 0) {
    if (existing) sim.removeBuff(unitId, BUFF.takeAim);
  } else if (!existing || existing.attackRange !== bonus) {
    sim.addBuff(unitId, { id: BUFF.takeAim, sourceId: unitId, expiresAt: Number.POSITIVE_INFINITY, attackRange: bonus });
  }
  return bonus;
};

export const createTakeAimImpl = (): AbilityImpl => ({
  id: TAKE_AIM,
  tick(ctx) {
    // The human player's buff follows the scope (see kit); everyone else always "takes aim".
    if (!ctx.caster.hero?.isPlayer) applyTakeAim(ctx.sim, ctx.caster.id, true);
  },
});
