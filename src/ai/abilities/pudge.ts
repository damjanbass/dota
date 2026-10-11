// Pudge (6.83d values in src/data/heroes/pudge.ts): Meat Hook, Rot, Flesh Heap, Dismember.
import type { AbilityContext, AbilityImpl, SimApi, UnitState } from '../../core/sim';
import { ABILITIES, ATTRIBUTES, levelValue } from '../../data';
import {
  advanceLine,
  canAffect,
  consumeSpellBlock,
  damageTypeOf,
  dir2,
  isDisabled,
  isInvulnerable,
  isMagicImmune,
  isStructure,
  kitState,
  newSkillshot,
  removeSkillshot,
  setStacks,
  sr,
  stacksOf,
  toggleKey,
  type Skillshot,
} from './common';

export const HOOK_DRAG_BUFF = 'pudge_meat_hook';
export const DISMEMBER_BUFF = 'pudge_dismember';
export const ROT_SLOW_BUFF = 'pudge_rot';
export const FLESH_HEAP_BUFF = 'pudge_flesh_heap';
const FLESH_HEAP_KEY = 'flesh_heap_str';

/** Units Meat Hook can snag: anything but Pudge himself, structures and invulnerable / magic-immune units. */
const hookable = (pudge: UnitState, u: UnitState): boolean =>
  u.alive && u.id !== pudge.id && !isStructure(u) && !isInvulnerable(u) && !isMagicImmune(u);

const releaseDragged = (sim: SimApi, shot: Skillshot): void => {
  if (shot.targetId !== undefined) sim.removeBuff(shot.targetId, HOOK_DRAG_BUFF);
};

const hookStep = (ctx: AbilityContext, shot: Skillshot, dt: number): void => {
  const { sim, caster } = ctx;
  if (!caster.alive) {
    releaseDragged(sim, shot);
    removeSkillshot(sim, shot);
    return;
  }
  if (shot.phase === 'out') {
    advanceLine(shot, shot.speed * dt, (s) => {
      let best: UnitState | undefined;
      let bestD = s.radius * s.radius;
      for (const u of sim.query(s.x, s.y, s.radius + 64, { aliveOnly: true })) {
        if (!hookable(caster, u)) continue;
        const d = (u.position.x - s.x) ** 2 + (u.position.y - s.y) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = u;
        }
      }
      if (!best) return false;
      s.phase = 'back';
      if (best.team !== caster.team) {
        if (consumeSpellBlock(sim, best)) return true;
        sim.dealDamage({ sourceId: caster.id, targetId: best.id, amount: ctx.value('damage'), type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
      }
      if (best.alive && best.kind !== 'roshan') {
        s.targetId = best.id;
        sim.addBuff(best.id, { id: HOOK_DRAG_BUFF, sourceId: caster.id, expiresAt: sim.time + 0.2, stunned: true });
      }
      return true;
    });
    if (shot.traveled >= shot.maxDist) shot.phase = 'back';
    return;
  }
  // Retract toward Pudge's current position, dragging the target along the chain head.
  const retract = ctx.value('linkLength') / ctx.value('retractInterval');
  const dx = caster.position.x - shot.x;
  const dy = caster.position.y - shot.y;
  const d = Math.hypot(dx, dy);
  const target = shot.targetId !== undefined ? sim.get(shot.targetId) : undefined;
  const stopAt = target ? caster.def.collisionRadius + target.def.collisionRadius + 8 : 0;
  const step = retract * dt;
  if (d - step <= stopAt) {
    const k = d > 1e-6 ? Math.max(0, d - stopAt) / d : 0;
    shot.x += dx * k;
    shot.y += dy * k;
    if (target?.alive) sim.teleport(target.id, shot.x, shot.y);
    releaseDragged(sim, shot);
    removeSkillshot(sim, shot);
    return;
  }
  shot.x += (dx / d) * step;
  shot.y += (dy / d) * step;
  if (target?.alive) {
    sim.teleport(target.id, shot.x, shot.y);
    sim.addBuff(target.id, { id: HOOK_DRAG_BUFF, sourceId: caster.id, expiresAt: sim.time + 0.2, stunned: true });
  } else if (target) shot.targetId = undefined;
};

export const meatHook = (): AbilityImpl => ({
  id: 'pudge_meat_hook',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const aim = target.point ?? (target.targetId !== undefined ? sim.get(target.targetId)?.position : undefined) ?? caster.position;
    const dir = dir2(caster.position, aim, caster.facing);
    const link = ctx.value('linkLength');
    newSkillshot(sim, {
      kind: 'meat_hook',
      casterId: caster.id,
      abilityId: ctx.def.id,
      x: caster.position.x,
      y: caster.position.y,
      originX: caster.position.x,
      originY: caster.position.y,
      dirX: dir.x,
      dirY: dir.y,
      maxDist: sr(ctx.value('maxLinks') * link),
      speed: link / ctx.value('extendInterval'),
      radius: ctx.value('hitRadius'),
      level: ctx.level,
    });
  },
  tick(ctx, dt) {
    const shots = kitState(ctx.sim).skillshots.filter((s) => s.kind === 'meat_hook' && s.casterId === ctx.caster.id);
    for (const s of shots) hookStep(ctx, s, dt);
  },
});

/** Rot: toggle (cast flips it). Ticks every 0.2 s on Pudge and enemies in range, with a 20% slow. */
export const rot = (): AbilityImpl => {
  const acc = new Map<number, number>();
  return {
    id: 'pudge_rot',
    cast(ctx) {
      const s = kitState(ctx.sim);
      const key = toggleKey(ctx.caster.id, ctx.def.id);
      s.toggles.set(key, !(s.toggles.get(key) ?? false));
      acc.set(ctx.caster.id, 0);
    },
    tick(ctx, dt) {
      const { sim, caster } = ctx;
      const s = kitState(sim);
      const key = toggleKey(caster.id, ctx.def.id);
      if (!s.toggles.get(key)) return;
      if (!caster.alive) {
        s.toggles.set(key, false);
        return;
      }
      const interval = ctx.value('tickInterval');
      let t = (acc.get(caster.id) ?? 0) + dt;
      while (t >= interval) {
        t -= interval;
        const dmg = ctx.value('damagePerTick');
        const radius = sr(ctx.value('radius'));
        for (const u of sim.query(caster.position.x, caster.position.y, radius, { notTeam: caster.team, aliveOnly: true })) {
          if (!canAffect(u) || isStructure(u)) continue;
          sim.dealDamage({ sourceId: caster.id, targetId: u.id, amount: dmg, type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
          if (u.alive) sim.addBuff(u.id, { id: ROT_SLOW_BUFF, sourceId: caster.id, expiresAt: sim.time + interval + 0.1, moveSpeedPct: -ctx.value('moveSlow') });
        }
        if (ctx.value('damagesSelf') > 0 && caster.alive) {
          sim.dealDamage({ sourceId: caster.id, targetId: caster.id, amount: dmg, type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
        }
        if (!caster.alive) break;
      }
      acc.set(caster.id, t);
    },
  };
};

/**
 * Flesh Heap: strength per enemy hero Pudge kills (the "nearby" radius isn't in the data, VERIFY #18).
 * Strength → +1 damage per point (primary attribute) as a permanent buff. The magic damage reduction
 * and the +19 HP per strength need contract support (see CONTRACT_REQUESTS.md G2).
 */
export const fleshHeap = (sim: SimApi): AbilityImpl => {
  sim.events.on('unit:died', ({ unitId, killerId }) => {
    if (killerId === null) return;
    const victim = sim.get(unitId);
    const pudge = sim.get(killerId);
    if (!victim?.hero || !pudge?.hero || victim.team === pudge.team) return;
    const level = pudge.hero.skillLevels['pudge_flesh_heap'] ?? 0;
    if (level <= 0) return;
    const per = levelValue(ABILITIES['pudge_flesh_heap']!, 'strengthPerHeroDeath', level);
    setStacks(sim, pudge.id, FLESH_HEAP_KEY, stacksOf(sim, pudge.id, FLESH_HEAP_KEY) + per);
  });
  return {
    id: 'pudge_flesh_heap',
    tick(ctx) {
      const str = stacksOf(ctx.sim, ctx.caster.id, FLESH_HEAP_KEY);
      if (str <= 0) return;
      const damage = str * ATTRIBUTES.damagePerPrimary;
      const cur = ctx.caster.buffs.find((b) => b.id === FLESH_HEAP_BUFF);
      if (cur?.damage === damage) return;
      ctx.sim.addBuff(ctx.caster.id, { id: FLESH_HEAP_BUFF, sourceId: ctx.caster.id, expiresAt: Infinity, damage });
    },
  };
};

/** Dismember: channel; the target is disabled and takes damage per second (3 s on heroes, 6 s on creeps). */
export const dismember = (): AbilityImpl => ({
  id: 'pudge_dismember',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const t = target.targetId !== undefined ? sim.get(target.targetId) : undefined;
    if (!canAffect(t) || t.team === caster.team) return;
    if (consumeSpellBlock(sim, t)) return;
    const duration = t.hero ? ctx.value('heroDuration') : ctx.value('creepDuration');
    const endsAt = sim.time + duration;
    sim.addBuff(t.id, {
      id: DISMEMBER_BUFF,
      sourceId: caster.id,
      expiresAt: endsAt,
      stunned: true,
      dps: { amount: ctx.value('damagePerSecond'), type: damageTypeOf(ctx) },
    });
    kitState(sim).channels.set(caster.id, { abilityId: ctx.def.id, targetId: t.id, endsAt });
  },
  tick(ctx) {
    const { sim, caster } = ctx;
    const s = kitState(sim);
    const ch = s.channels.get(caster.id);
    if (!ch || ch.abilityId !== ctx.def.id) return;
    const t = sim.get(ch.targetId);
    if (sim.time >= ch.endsAt || !t?.alive) {
      s.channels.delete(caster.id);
      return;
    }
    if (isDisabled(caster)) {
      sim.removeBuff(t.id, DISMEMBER_BUFF);
      s.channels.delete(caster.id);
    }
  },
});

export const pudgeAbilities = (sim: SimApi): AbilityImpl[] => [meatHook(), rot(), fleshHeap(sim), dismember()];
