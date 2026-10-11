// F Town Portal Scroll (sim side). The sim spends mana, starts the cooldown and consumes the scroll when the cast
// resolves (so a cancelled TP is wasted, like DotA). The impl then channels channelTime; a stun, a silence, death or
// moving away cancels it. On completion the caster lands next to the allied structure nearest the targeted point.
import { PLAYER_RADIUS } from '../../core/config';
import { isWalkable } from '../../core/map';
import type { LoadedMap, MapEntityKind } from '../../core/map';
import type { AbilityImpl, SimApi, UnitState } from '../../core/sim';
import type { Lane, Team, Tier, Vec2 } from '../../core/types';
import { EPS, TOWN_PORTAL, hasBuffFlag } from './ids';
import { castPoint } from './shrapnel';

/** A place you can teleport to: an allied structure (sim unit, or a map entity before the sim spawns them). */
export interface PortalAnchor {
  unitId: number | null;
  x: number;
  y: number;
  kind: string;
  name: string;
  /** Footprint radius used to keep the landing spot outside the building. */
  radius: number;
  lane?: Lane;
  tier?: Tier;
}

export type PortalStatus = 'channeling' | 'done' | 'cancelled';

export interface PortalChannel {
  /** Increments per TP so observers can tell a new result from one they already handled. */
  seq: number;
  casterId: number;
  team: Team;
  startAt: number;
  endAt: number;
  /** Caster position when the channel started (move detection). */
  origin: Vec2;
  /** The targeted point (where the player clicked). */
  target: Vec2;
  anchor: PortalAnchor;
  landing: Vec2;
  landingMax: number;
  status: PortalStatus;
  reason: string | null;
  resolvedAt: number;
}

export interface PortalState {
  /** Latest channel per caster (kept after it resolves so the FPS side can read the result). */
  channels: Map<number, PortalChannel>;
  seq: number;
}

/** Moving farther than this from where the channel started cancels it (sim-side safety net for knockbacks etc.). */
export const PORTAL_MOVE_TOLERANCE = 40;
/** The map script never lands you closer than this to the structure. */
export const PORTAL_MIN_LANDING = 120;

const TP_UNIT_KINDS: ReadonlySet<string> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);
const TP_ENTITY_KINDS: ReadonlySet<MapEntityKind> = new Set<MapEntityKind>(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain']);

export const createPortalState = (): PortalState => ({ channels: new Map(), seq: 0 });

const LANE_NAME: Record<Lane, string> = { top: 'Top', mid: 'Mid', bot: 'Bot' };

export const anchorName = (kind: string, lane?: Lane, tier?: Tier): string => {
  const where = lane ? `${LANE_NAME[lane]} ` : '';
  switch (kind) {
    case 'tower':
      return tier === 4 ? 'Base Tower' : `${where}Tier ${tier ?? 1} Tower`;
    case 'barracks_melee':
      return `${where}Melee Barracks`;
    case 'barracks_ranged':
      return `${where}Ranged Barracks`;
    case 'ancient':
      return 'Ancient';
    case 'fountain':
      return 'Fountain';
    default:
      return 'Structure';
  }
};

const unitAnchor = (u: UnitState): PortalAnchor => ({
  unitId: u.id,
  x: u.position.x,
  y: u.position.y,
  kind: u.kind,
  name: anchorName(u.kind, u.lane, u.tier),
  radius: Math.max(u.def.collisionRadius, u.kind === 'ancient' ? 160 : u.kind.startsWith('barracks') ? 110 : 64),
  lane: u.lane,
  tier: u.tier,
});

/** Living allied structures; falls back to the map's entities if the sim has no structure units. */
export const portalAnchors = (sim: SimApi, team: Team): PortalAnchor[] => {
  const out: PortalAnchor[] = [];
  for (const u of sim.units()) if (u.alive && u.team === team && TP_UNIT_KINDS.has(u.kind)) out.push(unitAnchor(u));
  if (out.length > 0) return out;
  for (const e of sim.map.data.entities) {
    if (e.team !== team || !TP_ENTITY_KINDS.has(e.kind)) continue;
    out.push({ unitId: null, x: e.x, y: e.y, kind: e.kind, name: anchorName(e.kind, e.lane, e.tier), radius: e.kind === 'ancient' ? 160 : 100, lane: e.lane, tier: e.tier });
  }
  return out;
};

export const nearestAnchor = <T extends Vec2>(anchors: readonly T[], x: number, y: number): T | null => {
  let best: T | null = null;
  let bestD = Infinity;
  for (const a of anchors) {
    const d = (a.x - x) ** 2 + (a.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
};

const hullWalkable = (map: LoadedMap, x: number, y: number): boolean => {
  const r = PLAYER_RADIUS + 4;
  return isWalkable(map, x, y) && isWalkable(map, x + r, y) && isWalkable(map, x - r, y) && isWalkable(map, x, y + r) && isWalkable(map, x, y - r);
};

/**
 * Landing spot next to `anchor`, on the side of the targeted point, between max(120, footprint) and landingMax away.
 * `fallback` gives the direction when the point is on top of the building. Searches nearby for walkable ground.
 */
export const portalLanding = (map: LoadedMap, anchor: PortalAnchor, target: Vec2, landingMax: number, fallback: Vec2): Vec2 => {
  let dx = target.x - anchor.x;
  let dy = target.y - anchor.y;
  let d = Math.hypot(dx, dy);
  if (d < 1) {
    dx = fallback.x - anchor.x;
    dy = fallback.y - anchor.y;
    d = 0;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
  } else {
    dx /= d;
    dy /= d;
  }
  const minDist = Math.min(landingMax, Math.max(PORTAL_MIN_LANDING, anchor.radius + PLAYER_RADIUS + 24));
  const dist = Math.min(landingMax, Math.max(minDist, d));
  const base = Math.atan2(dy, dx);
  // Try the preferred spot first, then fan out in angle and distance.
  for (let ring = 0; ring < 6; ring++) {
    const r = Math.min(landingMax, dist + ring * 48);
    for (let k = 0; k <= 12; k++) {
      const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const x = anchor.x + Math.cos(base + off) * r;
      const y = anchor.y + Math.sin(base + off) * r;
      if (hullWalkable(map, x, y)) return { x, y };
    }
  }
  return { x: anchor.x + dx * dist, y: anchor.y + dy * dist };
};

const fountainOf = (sim: SimApi, team: Team): Vec2 => {
  const f = sim.map.data.entities.find((e) => e.kind === 'fountain' && e.team === team);
  if (f) return { x: f.x, y: f.y };
  const b = sim.map.data.bounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

/** Where a TP aimed at `target` would land right now (null if the team has no structure left). */
export const resolvePortal = (sim: SimApi, team: Team, target: Vec2, landingMax: number): { anchor: PortalAnchor; landing: Vec2 } | null => {
  const anchor = nearestAnchor(portalAnchors(sim, team), target.x, target.y);
  if (!anchor) return null;
  const home = anchor.kind === 'fountain' ? { x: (sim.map.data.bounds.minX + sim.map.data.bounds.maxX) / 2, y: (sim.map.data.bounds.minY + sim.map.data.bounds.maxY) / 2 } : fountainOf(sim, team);
  return { anchor, landing: portalLanding(sim.map, anchor, target, landingMax, home) };
};

export const startPortalChannel = (state: PortalState, sim: SimApi, caster: UnitState, target: Vec2, channelTime: number, landingMax: number): PortalChannel | null => {
  const resolved = resolvePortal(sim, caster.team, target, landingMax);
  if (!resolved) return null;
  const now = sim.time;
  const ch: PortalChannel = {
    seq: ++state.seq,
    casterId: caster.id,
    team: caster.team,
    startAt: now,
    endAt: now + channelTime,
    origin: { x: caster.position.x, y: caster.position.y },
    target: { x: target.x, y: target.y },
    anchor: resolved.anchor,
    landing: resolved.landing,
    landingMax,
    status: 'channeling',
    reason: null,
    resolvedAt: Number.NaN,
  };
  state.channels.set(caster.id, ch);
  return ch;
};

export const cancelPortal = (state: PortalState, casterId: number, reason: string, now: number): boolean => {
  const ch = state.channels.get(casterId);
  if (!ch || ch.status !== 'channeling') return false;
  ch.status = 'cancelled';
  ch.reason = reason;
  ch.resolvedAt = now;
  return true;
};

/** Cancels interrupted channels and teleports finished ones. Idempotent for a given sim time. */
export const advancePortals = (state: PortalState, sim: SimApi): void => {
  const now = sim.time;
  for (const ch of state.channels.values()) {
    if (ch.status !== 'channeling') continue;
    const u = sim.get(ch.casterId);
    if (!u || !u.alive) cancelPortal(state, ch.casterId, 'Died', now);
    else if (hasBuffFlag(u, 'stunned', now)) cancelPortal(state, ch.casterId, 'Stunned', now);
    else if (hasBuffFlag(u, 'silenced', now)) cancelPortal(state, ch.casterId, 'Silenced', now);
    else if (Math.hypot(u.position.x - ch.origin.x, u.position.y - ch.origin.y) > PORTAL_MOVE_TOLERANCE) cancelPortal(state, ch.casterId, 'Moved', now);
    else if (now >= ch.endAt - EPS) {
      // The targeted structure may have died during the channel: re-resolve against the living ones.
      const resolved = ch.anchor.unitId !== null && sim.get(ch.anchor.unitId)?.alive ? { anchor: ch.anchor, landing: ch.landing } : resolvePortal(sim, ch.team, ch.target, ch.landingMax);
      if (!resolved) {
        cancelPortal(state, ch.casterId, 'No destination', now);
        continue;
      }
      ch.anchor = resolved.anchor;
      ch.landing = resolved.landing;
      sim.teleport(u.id, ch.landing.x, ch.landing.y);
      ch.status = 'done';
      ch.resolvedAt = now;
    }
  }
};

export const createTownPortalImpl = (state: PortalState, process: (sim: SimApi) => void): AbilityImpl => ({
  id: TOWN_PORTAL,
  cast(ctx, target) {
    const p = castPoint(ctx.sim, target);
    if (p) startPortalChannel(state, ctx.sim, ctx.caster, p, ctx.value('channelTime'), ctx.value('landingMaxDistance'));
  },
  tick(ctx) {
    process(ctx.sim);
  },
});
