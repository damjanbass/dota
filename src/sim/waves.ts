// Lane creep waves (6.83d CREEP_WAVES): every 30 s from the horn, melee + ranged per lane, siege every 7th wave,
// +1 melee / +1 ranged at the listed times, upgrades every 450 s, super creeps per destroyed enemy barracks and
// mega creeps once all 6 enemy barracks are dead. Creeps walk their lane waypoints (Scourge in reverse).
import { entitiesOfKind } from '../core/map';
import type { Lane, Team, Vec2 } from '../core/types';
import { CREEP_WAVES, UNITS } from '../data';
import type { SimUnit } from './types';
import type { World } from './world';

export const LANES: readonly Lane[] = ['top', 'mid', 'bot'];

export interface LaneRoute {
  team: Team;
  lane: Lane;
  melee: Vec2;
  ranged: Vec2;
  /** Waypoints this team's creeps walk, ending at the enemy Ancient. */
  path: Vec2[];
}

export interface WaveState {
  enabled: boolean;
  routes: LaneRoute[];
  nextAt: number;
  /** 1-based number of the next wave. */
  number: number;
  /** team → lane → super creeps (from destroyed enemy barracks). */
  superMelee: Record<string, Record<Lane, boolean>>;
  superRanged: Record<string, Record<Lane, boolean>>;
  mega: Record<string, boolean>;
}

const segDist2 = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const qx = a.x + dx * t - p.x;
  const qy = a.y + dy * t - p.y;
  return qx * qx + qy * qy;
};

/** Waypoints after the segment closest to `from` (ties go to the later segment). */
export const routeFrom = (points: readonly Vec2[], from: Vec2): Vec2[] => {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = segDist2(from, points[i]!, points[i + 1]!);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return points.slice(best + 1).map((p) => ({ x: p.x, y: p.y }));
};

const buildRoutes = (w: World): LaneRoute[] => {
  const routes: LaneRoute[] = [];
  for (const team of ['sentinel', 'scourge'] as const) {
    const enemy = team === 'sentinel' ? 'scourge' : 'sentinel';
    const ancient = entitiesOfKind(w.map, 'ancient', enemy)[0];
    for (const lane of LANES) {
      const pts = w.map.data.lanes[lane];
      if (!pts || pts.length < 2) continue;
      const dir = team === 'sentinel' ? pts : [...pts].reverse();
      const spawn = entitiesOfKind(w.map, 'creep_spawn', team).find((e) => e.lane === lane);
      const melee = spawn ? { x: spawn.x, y: spawn.y } : { x: dir[0]!.x, y: dir[0]!.y };
      const rx = spawn?.meta?.rangedX;
      const ry = spawn?.meta?.rangedY;
      const path = routeFrom(dir, melee);
      const first = path[0] ?? melee;
      const len = Math.hypot(first.x - melee.x, first.y - melee.y) || 1;
      // No ranged marker (mock map): ranged creeps start 120 units behind the melee creeps.
      const ranged =
        typeof rx === 'number' && typeof ry === 'number'
          ? { x: rx, y: ry }
          : { x: melee.x - ((first.x - melee.x) / len) * 120, y: melee.y - ((first.y - melee.y) / len) * 120 };
      if (ancient) {
        const last = path[path.length - 1];
        if (!last || Math.hypot(last.x - ancient.x, last.y - ancient.y) > 100) path.push({ x: ancient.x, y: ancient.y });
      }
      routes.push({ team, lane, melee, ranged, path });
    }
  }
  return routes;
};

const laneFlags = (): Record<Lane, boolean> => ({ top: false, mid: false, bot: false });

export const initWaves = (w: World, enabled: boolean): void => {
  const first = CREEP_WAVES.firstWaveAt;
  const nextAt = w.time <= first ? first : first + Math.ceil((w.time - first) / CREEP_WAVES.interval) * CREEP_WAVES.interval;
  w.waves = {
    enabled,
    routes: buildRoutes(w),
    nextAt,
    number: Math.round((nextAt - first) / CREEP_WAVES.interval) + 1,
    superMelee: { sentinel: laneFlags(), scourge: laneFlags() },
    superRanged: { sentinel: laneFlags(), scourge: laneFlags() },
    mega: { sentinel: false, scourge: false },
  };
};

/** Creep counts for a wave spawning at map time `t` (wave number n, 1-based). */
export const waveComposition = (n: number, t: number): { melee: number; ranged: number; siege: number } => {
  const melee = CREEP_WAVES.initialMelee + CREEP_WAVES.extraMeleeAt.filter((x) => x <= t).length;
  const ranged = CREEP_WAVES.initialRanged + CREEP_WAVES.extraRangedAt.filter((x) => x <= t).length;
  const siege = n % CREEP_WAVES.siegeEveryNthWave === 0 ? ranged : 0;
  return { melee, ranged, siege };
};

export const upgradeLevel = (t: number): number => Math.min(CREEP_WAVES.upgradeMaxLevel, Math.floor(Math.max(0, t) / CREEP_WAVES.upgradeInterval));

/** Puts a creep on its team's lane route. */
export const assignLane = (w: World, u: SimUnit, lane: Lane): void => {
  const route = w.waves.routes.find((r) => r.team === u.team && r.lane === lane);
  if (!route) return;
  u.lane = lane;
  u.lanePath = route.path;
  u.laneIndex = 0;
  const wp = route.path[0];
  if (wp) u.order = { type: 'attackMove', x: wp.x, y: wp.y };
};

const spawnCreep = (w: World, route: LaneRoute, type: 'melee' | 'ranged' | 'siege', tier: '' | '_super' | '_mega', at: Vec2, upgrade: number): SimUnit => {
  const def = UNITS[`${route.team}_creep_${type}${tier}`]!;
  let bonusHp = 0;
  let bonusDamage = 0;
  if (type !== 'siege' && tier !== '_mega') {
    const per = CREEP_WAVES.upgradePerLevel[type === 'melee' ? (tier ? 'meleeSuper' : 'melee') : tier ? 'rangedSuper' : 'ranged'];
    bonusHp = per.hp * upgrade;
    bonusDamage = per.damage * upgrade;
  }
  const first = route.path[0] ?? at;
  const u = w.spawnUnit(def, route.team, at.x, at.y, {
    lane: route.lane,
    facing: Math.atan2(first.y - at.y, first.x - at.x),
    bonusHp,
    bonusDamage,
  });
  assignLane(w, u, route.lane);
  return u;
};

const spawnWave = (w: World, n: number, t: number): void => {
  const comp = waveComposition(n, t);
  const upgrade = upgradeLevel(t);
  const early = t < CREEP_WAVES.earlyLaneSpeed.firstSeconds;
  for (const route of w.waves.routes) {
    const mega = w.waves.mega[route.team]!;
    const meleeTier = mega ? '_mega' : w.waves.superMelee[route.team]![route.lane] ? '_super' : '';
    const rangedTier = mega ? '_mega' : w.waves.superRanged[route.team]![route.lane] ? '_super' : '';
    const first = route.path[0] ?? route.melee;
    const len = Math.hypot(first.x - route.melee.x, first.y - route.melee.y) || 1;
    // Formation: a short row across the lane so separation has little to do.
    const sx = -(first.y - route.melee.y) / len;
    const sy = (first.x - route.melee.x) / len;
    const spawned: SimUnit[] = [];
    for (let i = 0; i < comp.melee; i++) {
      const o = (i - (comp.melee - 1) / 2) * 40;
      spawned.push(spawnCreep(w, route, 'melee', meleeTier, { x: route.melee.x + sx * o, y: route.melee.y + sy * o }, upgrade));
    }
    for (let i = 0; i < comp.ranged; i++) {
      const o = (i - (comp.ranged - 1) / 2) * 40;
      spawned.push(spawnCreep(w, route, 'ranged', rangedTier, { x: route.ranged.x + sx * o, y: route.ranged.y + sy * o }, upgrade));
    }
    for (let i = 0; i < comp.siege; i++) {
      const o = (i + 1) * 60;
      const bx = route.ranged.x - ((first.x - route.melee.x) / len) * o;
      const by = route.ranged.y - ((first.y - route.melee.y) / len) * o;
      spawned.push(spawnCreep(w, route, 'siege', rangedTier, { x: bx, y: by }, upgrade));
    }
    if (early && route.lane !== 'mid') {
      const s = CREEP_WAVES.earlyLaneSpeed;
      const faster = (route.lane === 'top') === (route.team === 'scourge');
      for (const u of spawned) {
        w.addBuff(u.id, { id: 'early_lane_speed', sourceId: null, expiresAt: t + s.buffDuration, moveSpeedPct: faster ? s.fasterPct : s.slowerPct });
      }
    }
  }
};

export const tickWaves = (w: World): void => {
  const s = w.waves;
  while (w.time >= s.nextAt) {
    if (s.enabled) spawnWave(w, s.number, s.nextAt);
    s.number++;
    s.nextAt += CREEP_WAVES.interval;
  }
};
