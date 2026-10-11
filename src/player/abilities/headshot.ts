// Headshot (passive, sim side). Runs on Sniper's outgoing basic attacks: a real FPS headshot (req.headshot) always
// procs, otherwise it rolls `chance` with the sim RNG. A proc adds bonusDamage to the attack (so it goes through
// the attack-type × armor math like the map's ATTACK_TYPE_HERO damage) and applies a short 100% slow.
// Never procs on structures.
import type { AbilityImpl } from '../../core/sim';
import { BUFF, HEADSHOT, isBuilding } from './ids';

export const createHeadshotImpl = (): AbilityImpl => ({
  id: HEADSHOT,
  onAttack(ctx, req) {
    if (!req.isAttack) return;
    const target = ctx.sim.get(req.targetId);
    if (!target || isBuilding(target.kind)) {
      // Structures have no head: keep unit:damaged honest.
      req.headshot = false;
      return;
    }
    const proc = req.headshot === true || ctx.sim.rng.chance(ctx.value('chance'));
    if (!proc) return;
    req.headshot = true;
    req.amount += ctx.value('bonusDamage');
    ctx.sim.addBuff(target.id, {
      id: BUFF.headshotSlow,
      sourceId: ctx.caster.id,
      expiresAt: ctx.sim.time + ctx.value('slowDuration'),
      moveSpeedPct: -ctx.value('moveSlow'),
    });
  },
});
