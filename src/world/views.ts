// Camera presets computed from map entities (work on the mock and the real map). Pure: all
// positions are WC3 coordinates; heights come from the passed sampler (absolute map heights).
import { EYE_HEIGHT } from '../core/config';
import { PathFlag, groundHeightAt, pathingAt } from '../core/map';
import type { LoadedMap, MapEntity } from '../core/map';
import type { Vec2, Vec3 } from '../core/types';

export const MAP_VIEWS = ['sentinel_base', 'scourge_base', 'mid', 'river', 'roshan'] as const;
export type MapViewName = (typeof MAP_VIEWS)[number];

export interface ViewPreset {
  /** Camera (eye) position, WC3 coords. */
  position: Vec3;
  /** Look-at point, WC3 coords. */
  target: Vec3;
}

type HeightFn = (x: number, y: number) => number;

const norm = (x: number, y: number): Vec2 => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

const find = (map: LoadedMap, pred: (e: MapEntity) => boolean): MapEntity | undefined => map.data.entities.find(pred);

const mapCenter = (map: LoadedMap): Vec2 => {
  const b = map.data.bounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

const SOLID_KINDS = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'shop', 'secret_shop', 'side_shop', 'tavern', 'roshan', 'other']);

/** Clearance radius around solid entities (ancients and fountains are big). */
const clearance = (e: MapEntity): number =>
  e.kind === 'ancient' ? 620 : e.kind === 'fountain' ? 400 : e.kind === 'roshan' ? 420 : e.kind === 'other' ? 220 : 330;

/** True when (x, y) is walkable, tree-free and away from buildings. Pure. */
export const isClearSpot = (map: LoadedMap, x: number, y: number): boolean => {
  for (let dy = -96; dy <= 96; dy += 48) {
    for (let dx = -96; dx <= 96; dx += 48) {
      if (pathingAt(map, x + dx, y + dy) & (PathFlag.Unwalkable | PathFlag.Tree)) return false;
    }
  }
  for (const t of map.data.trees) {
    if (Math.abs(t[0] - x) < 220 && Math.abs(t[1] - y) < 220 && Math.hypot(t[0] - x, t[1] - y) < 220) return false;
  }
  return !map.data.entities.some((e) => SOLID_KINDS.has(e.kind) && Math.hypot(e.x - x, e.y - y) < clearance(e));
};

/** Nearest clear spot to (x, y) on growing rings (falls back to the input). Pure. */
export const nearestClearSpot = (map: LoadedMap, x: number, y: number): Vec2 => {
  if (isClearSpot(map, x, y)) return { x, y };
  for (let r = 64; r <= 1600; r += 64) {
    const n = Math.max(8, Math.round((r / 64) * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (isClearSpot(map, px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
};

/** Eye position standing at (x, y): ground (or water surface if higher) + eye height. */
export const eyeAt = (map: LoadedMap, ground: HeightFn, x: number, y: number, extra = 0): Vec3 => {
  const t = map.data.terrain;
  const ix = Math.min(t.cols - 1, Math.max(0, Math.round((x - t.originX) / t.cellSize)));
  const iy = Math.min(t.rows - 1, Math.max(0, Math.round((y - t.originY) / t.cellSize)));
  const w = map.water[iy * t.cols + ix]!;
  const g = ground(x, y);
  return { x, y, z: Math.max(g, Number.isNaN(w) ? -Infinity : w) + EYE_HEIGHT + extra };
};

/** Direction toward the nearest water tilepoint within 3000 units, else the map centre. */
const towardWater = (map: LoadedMap, x: number, y: number): number => {
  const t = map.data.terrain;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let iy = 0; iy < t.rows; iy++) {
    for (let ix = 0; ix < t.cols; ix++) {
      if (Number.isNaN(map.water[iy * t.cols + ix]!)) continue;
      const wx = t.originX + ix * t.cellSize;
      const wy = t.originY + iy * t.cellSize;
      const d = Math.hypot(wx - x, wy - y);
      if (d < best) {
        best = d;
        bx = wx;
        by = wy;
      }
    }
  }
  if (best > 3000) {
    const c = mapCenter(map);
    bx = c.x;
    by = c.y;
  }
  return Math.atan2(by - y, bx - x);
};

/** True if the ground between a and b stays below the straight line ~120 units above both. */
const lineOfSight = (ground: HeightFn, ax: number, ay: number, bx: number, by: number): boolean => {
  const za = ground(ax, ay) + 120;
  const zb = ground(bx, by) + 120;
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    if (ground(ax + (bx - ax) * t, ay + (by - ay) * t) > za + (zb - za) * t - 20) return false;
  }
  return true;
};

/**
 * Direction the Roshan pit opens toward (WC3 facing): an open, same-level, visible direction
 * as close as possible to the nearest water. Pure (uses the map's bilinear ground by default).
 */
export const roshanPitFacing = (
  map: LoadedMap,
  x: number,
  y: number,
  ground: HeightFn = (gx, gy) => groundHeightAt(map, gx, gy),
): number => {
  const pref = towardWater(map, x, y);
  const z = ground(x, y);
  let best = pref;
  let bestScore = Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const px = x + Math.cos(a) * 700;
    const py = y + Math.sin(a) * 700;
    if (Math.abs(ground(px, py) - z) > 90 || !isClearSpot(map, px, py) || !lineOfSight(ground, x, y, px, py)) continue;
    const diff = Math.abs(Math.atan2(Math.sin(a - pref), Math.cos(a - pref)));
    if (diff < bestScore) {
      bestScore = diff;
      best = a;
    }
  }
  return best;
};

const baseView = (map: LoadedMap, ground: HeightFn, team: 'sentinel' | 'scourge'): ViewPreset => {
  const fountain = find(map, (e) => e.kind === 'fountain' && e.team === team);
  const ancient = find(map, (e) => e.kind === 'ancient' && e.team === team);
  const c = mapCenter(map);
  const from = fountain ?? { x: c.x + (team === 'sentinel' ? -4000 : 4000), y: c.y + (team === 'sentinel' ? -4000 : 4000) };
  const to = ancient ?? c;
  // Approach the ancient from the map-centre side (as attackers do), tier-4 towers framing it.
  void from;
  const d = norm(c.x - to.x, c.y - to.y);
  const c0 = nearestClearSpot(map, to.x + d.x * 1250 - d.y * 150, to.y + d.y * 1250 + d.x * 150);
  return { position: eyeAt(map, ground, c0.x, c0.y), target: { x: to.x, y: to.y, z: ground(to.x, to.y) + 380 } };
};

const midView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const s1 = find(map, (e) => e.kind === 'tower' && e.team === 'sentinel' && e.lane === 'mid' && e.tier === 1);
  const u1 = find(map, (e) => e.kind === 'tower' && e.team === 'scourge' && e.lane === 'mid' && e.tier === 1);
  const c = mapCenter(map);
  const a = s1 ?? { x: c.x - 1500, y: c.y - 1500 };
  const b = u1 ?? { x: c.x + 1500, y: c.y + 1500 };
  const d = norm(b.x - a.x, b.y - a.y);
  // Just in front of the Sentinel tier-1 tower, off to the side, looking down the lane.
  const c0 = nearestClearSpot(map, a.x + d.x * 380 + d.y * 260, a.y + d.y * 380 - d.x * 260);
  return { position: eyeAt(map, ground, c0.x, c0.y, 10), target: { x: b.x, y: b.y, z: ground(b.x, b.y) + 200 } };
};

const riverView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const runes = map.data.entities.filter((e) => e.kind === 'rune_spot');
  const c = mapCenter(map);
  const r0 = runes[0] ?? c;
  const other = runes[1] ?? c;
  const d = norm(other.x - r0.x, other.y - r0.y);
  // Stand in the river toward the other rune, looking back at this rune spot and up-river.
  const c0 = nearestClearSpot(map, r0.x + d.x * 850, r0.y + d.y * 850);
  const px = c0.x;
  const py = c0.y;
  const tx = r0.x - d.x * 300;
  const ty = r0.y - d.y * 300;
  return { position: eyeAt(map, ground, px, py), target: { x: tx, y: ty, z: ground(tx, ty) + 40 } };
};

const roshanView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const c = mapCenter(map);
  const r = find(map, (e) => e.kind === 'roshan') ?? { x: c.x - 2000, y: c.y + 2000 };
  const f = roshanPitFacing(map, r.x, r.y, ground);
  const c0 = nearestClearSpot(map, r.x + Math.cos(f) * 700 + Math.sin(f) * 120, r.y + Math.sin(f) * 700 - Math.cos(f) * 120);
  return { position: eyeAt(map, ground, c0.x, c0.y, 20), target: { x: r.x, y: r.y, z: ground(r.x, r.y) + 160 } };
};

/** Camera preset for a named view on any LoadedMap. */
export const computeView = (map: LoadedMap, name: MapViewName, ground: HeightFn): ViewPreset => {
  switch (name) {
    case 'sentinel_base':
      return baseView(map, ground, 'sentinel');
    case 'scourge_base':
      return baseView(map, ground, 'scourge');
    case 'mid':
      return midView(map, ground);
    case 'river':
      return riverView(map, ground);
    case 'roshan':
      return roshanView(map, ground);
  }
};
