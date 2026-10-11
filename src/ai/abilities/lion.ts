// Lion (6.83d values in src/data/heroes/lion.ts): Impale (Earth Spike), Voodoo (Hex), Mana Drain,
// Finger of Death.
import type { AbilityImpl, SimApi } from '../../core/sim';
import {
  advanceLine,
  canAffect,
  consumeSpellBlock,
  damageTypeOf,
  dir2,
  isDisabled,
  kitState,
  newSkillshot,
  removeSkillshot,
  spellTargetsAround,
  sr,
} from './common';

export const IMPALE_STUN_BUFF = 'lion_impale';
/**
 * Hex stand-in: the contract has no hexed / disarmed flags yet (CONTRACT_REQUESTS.md G1), so Voodoo is
 * silenced + damagePct -1 (attacks deal no damage). No movement change: the critter speed isn't in the data.
 */
export const HEX_BUFF = 'lion_voodoo';

/** Impale: a 700-long spike line from Lion toward the target point, stunning and damaging each enemy once. */
export const impale = (): AbilityImpl => ({
  id: 'lion_impale',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const aim = target.point ?? (target.targetId !== undefined ? sim.get(target.targetId)?.position : undefined) ?? caster.position;
    const dir = dir2(caster.position, aim, caster.facing);
    newSkillshot(sim, {
      kind: 'impale',
      casterId: caster.id,
      abilityId: ctx.def.id,
      x: caster.position.x,
      y: caster.position.y,
      originX: caster.position.x,
      originY: caster.position.y,
      dirX: dir.x,
      dirY: dir.y,
      maxDist: sr(ctx.value('travelDistance')),
      speed: ctx.value('travelSpeed'),
      radius: ctx.value('lineRadius'),
      level: ctx.level,
    });
  },
  tick(ctx, dt) {
    const { sim, caster } = ctx;
    for (const shot of kitState(sim).skillshots.filter((s) => s.kind === 'impale' && s.casterId === caster.id)) {
      advanceLine(shot, shot.speed * dt, (s) => {
        for (const u of spellTargetsAround(sim, caster, s.x, s.y, s.radius)) {
          if (s.hit.has(u.id)) continue;
          s.hit.add(u.id);
          sim.dealDamage({ sourceId: caster.id, targetId: u.id, amount: ctx.value('damage'), type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
          if (u.alive) sim.addBuff(u.id, { id: IMPALE_STUN_BUFF, sourceId: caster.id, expiresAt: sim.time + ctx.value('stunDuration'), stunned: true });
        }
        return false;
      });
      if (shot.traveled >= shot.maxDist) removeSkillshot(sim, shot);
    }
  },
});

export const voodoo = (): AbilityImpl => ({
  id: 'lion_voodoo',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team || consumeSpellBlock(sim, t)) return;
    sim.addBuff(t.id, { id: HEX_BUFF, sourceId: caster.id, expiresAt: sim.time + ctx.value('duration'), silenced: true, damagePct: -1 });
  },
});

/** Mana Drain: channel, moves mana from the target to Lion each tick; breaks beyond 1200 (scaled). */
export const manaDrain = (): AbilityImpl => ({
  id: 'lion_mana_drain',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team || consumeSpellBlock(sim, t)) return;
    kitState(sim).channels.set(caster.id, { abilityId: ctx.def.id, targetId: t.id, endsAt: sim.time + ctx.value('duration') });
  },
  tick(ctx, dt) {
    const { sim, caster } = ctx;
    const s = kitState(sim);
    const ch = s.channels.get(caster.id);
    if (!ch || ch.abilityId !== ctx.def.id) return;
    const t = sim.get(ch.targetId);
    const range = sr(ctx.value('breakDistance'));
    if (
      sim.time >= ch.endsAt ||
      !canAffect(t) ||
      isDisabled(caster) ||
      !sim.isVisibleTo(caster.team, t.id) ||
      (t.position.x - caster.position.x) ** 2 + (t.position.y - caster.position.y) ** 2 > range * range
    ) {
      s.channels.delete(caster.id);
      return;
    }
    const drained = Math.min(t.mana, ctx.value('manaPerSecond') * dt);
    if (drained <= 0) return;
    // No drain API in the contract: the sim owns UnitState, so mutate the target's pool directly.
    t.mana -= drained;
    sim.restoreMana(caster.id, drained);
  },
});

export const fingerOfDeath = (): AbilityImpl => ({
  id: 'lion_finger_of_death',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team || consumeSpellBlock(sim, t)) return;
    sim.dealDamage({ sourceId: caster.id, targetId: t.id, amount: ctx.value('damage'), type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
  },
});

export const lionAbilities = (_sim: SimApi): AbilityImpl[] => [impale(), voodoo(), manaDrain(), fingerOfDeath()];
