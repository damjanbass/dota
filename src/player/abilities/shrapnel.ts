// Q Shrapnel (sim side). A cast drops a field at a ground point: after firstTickDelay it deals magical damage to
// enemy units inside every tickInterval (ticks times) and refreshes a slow on them. Structures are excluded.
// Charges, mana and cast range are handled generically by the sim.
import { scaledRange } from '../../core/config';
import type { AbilityContext, AbilityImpl, CastTarget, SimApi } from '../../core/sim';
import type { Team, Vec2 } from '../../core/types';
import { BUFF, EPS, SHRAPNEL, hasBuffFlag, isBuilding } from './ids';

export interface ShrapnelField {
  id: number;
  casterId: number;
  team: Team;
  x: number;
  y: number;
  level: number;
  /** Visual / nominal radius (data `radius`). */
  radius: number;
  /** Enumeration radius (radius + radiusFudge, like the map script). */
  hitRadius: number;
  startAt: number;
  /** Visual end (max of duration and the last tick). */
  endAt: number;
  interval: number;
  nextTickAt: number;
  ticksLeft: number;
  ticksDone: number;
  damagePerTick: number;
  moveSlow: number;
  slowDuration: number;
  lockout: number;
  buildingDamagePct: number;
}

export interface ShrapnelState {
  fields: ShrapnelField[];
  /** unitId → last Shrapnel damage (sim time of the tick + which field dealt it). */
  lastHit: Map<number, { at: number; fieldId: number }>;
  nextId: number;
}

/** Optional sim extension for area vision (see CONTRACT_REQUESTS.md, F1). */
export interface VisionApi {
  addVision(team: Team, x: number, y: number, radius: number, expiresAt: number): void;
}

export const createShrapnelState = (): ShrapnelState => ({ fields: [], lastHit: new Map(), nextId: 1 });

export const castPoint = (sim: SimApi, target: CastTarget): Vec2 | null => {
  if (target.point) return target.point;
  if (target.targetId !== undefined) {
    const u = sim.get(target.targetId);
    if (u) return { x: u.position.x, y: u.position.y };
  }
  return null;
};

export const spawnShrapnelField = (state: ShrapnelState, ctx: AbilityContext, point: Vec2): ShrapnelField => {
  const v = ctx.value;
  const now = ctx.sim.time;
  const interval = v('tickInterval');
  const ticks = v('ticks');
  const first = v('firstTickDelay');
  const field: ShrapnelField = {
    id: state.nextId++,
    casterId: ctx.caster.id,
    team: ctx.caster.team,
    x: point.x,
    y: point.y,
    level: ctx.level,
    radius: v('radius'),
    hitRadius: v('radius') + v('radiusFudge'),
    startAt: now,
    endAt: now + Math.max(v('duration'), first + (ticks - 1) * interval),
    interval,
    nextTickAt: now + first,
    ticksLeft: ticks,
    ticksDone: 0,
    damagePerTick: v('damagePerSecond') * interval,
    moveSlow: v('moveSlow'),
    slowDuration: v('slowDuration'),
    lockout: v('sameTargetLockout'),
    buildingDamagePct: v('buildingDamagePct'),
  };
  state.fields.push(field);
  // Area vision is a sim feature the contract doesn't expose yet; use it when the sim offers it.
  const vision = ctx.sim as SimApi & Partial<VisionApi>;
  vision.addVision?.(field.team, field.x, field.y, scaledRange(v('visionRadius')), now + v('visionDuration'));
  return field;
};

/**
 * One damage tick of a field at scheduled time `t`. Lockout semantics (map script: 1.1 s per unit): a unit hit by
 * Shrapnel can't be hit by a *different* field until `lockout` seconds later, so overlapping fields don't stack,
 * while a single field still hits every tickInterval (its advertised DPS).
 */
const tickField = (state: ShrapnelState, sim: SimApi, f: ShrapnelField, t: number): void => {
  const now = sim.time;
  const r2 = f.hitRadius * f.hitRadius;
  for (const u of sim.query(f.x, f.y, f.hitRadius, { notTeam: f.team, aliveOnly: true })) {
    if (!u.alive || u.team === f.team) continue;
    const dx = u.position.x - f.x;
    const dy = u.position.y - f.y;
    if (dx * dx + dy * dy > r2) continue;
    const building = isBuilding(u.kind);
    if (building && f.buildingDamagePct <= 0) continue;
    if (!building && !hasBuffFlag(u, 'magicImmune', now)) {
      sim.addBuff(u.id, { id: BUFF.shrapnelSlow, sourceId: f.casterId, expiresAt: now + f.slowDuration, moveSpeedPct: -f.moveSlow });
    }
    const last = state.lastHit.get(u.id);
    if (last && last.fieldId !== f.id && t - last.at < f.lockout - EPS) continue;
    state.lastHit.set(u.id, { at: t, fieldId: f.id });
    sim.dealDamage({
      sourceId: f.casterId,
      targetId: u.id,
      amount: f.damagePerTick * (building ? f.buildingDamagePct : 1),
      type: 'magical',
      isAttack: false,
      abilityId: SHRAPNEL,
    });
  }
};

/** Runs every due tick and drops finished fields. Idempotent for a given sim time. */
export const advanceShrapnel = (state: ShrapnelState, sim: SimApi): void => {
  const now = sim.time;
  for (const f of state.fields) {
    while (f.ticksLeft > 0 && f.nextTickAt <= now + EPS) {
      tickField(state, sim, f, f.nextTickAt);
      f.ticksLeft--;
      f.ticksDone++;
      f.nextTickAt += f.interval;
    }
  }
  if (state.fields.some((f) => f.ticksLeft === 0 && now >= f.endAt - EPS)) {
    state.fields = state.fields.filter((f) => f.ticksLeft > 0 || now < f.endAt - EPS);
  }
  if (state.lastHit.size > 64) {
    for (const [id, hit] of state.lastHit) if (now - hit.at > 10) state.lastHit.delete(id);
  }
};

export const createShrapnelImpl = (state: ShrapnelState, process: (sim: SimApi) => void): AbilityImpl => ({
  id: SHRAPNEL,
  cast(ctx, target) {
    const p = castPoint(ctx.sim, target);
    if (p) spawnShrapnelField(state, ctx, p);
  },
  tick(ctx) {
    process(ctx.sim);
  },
});
