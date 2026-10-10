// Camera presets computed from map entities (work on the mock and the real map). Pure: all
// positions are WC3 coordinates; heights come from the passed sampler (absolute map heights).
import { EYE_HEIGHT } from '../core/config';
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

/** Eye position standing at (x, y): ground (or water surface if higher) + eye height. */
export const eyeAt = (map: LoadedMap, ground: HeightFn, x: number, y: number, extra = 0): Vec3 => {
  const t = map.data.terrain;
  const ix = Math.min(t.cols - 1, Math.max(0, Math.round((x - t.originX) / t.cellSize)));
  const iy = Math.min(t.rows - 1, Math.max(0, Math.round((y - t.originY) / t.cellSize)));
  const w = map.water[iy * t.cols + ix]!;
  const g = ground(x, y);
  return { x, y, z: Math.max(g, Number.isNaN(w) ? -Infinity : w) + EYE_HEIGHT + extra };
};

/**
 * Direction the Roshan pit opens toward: the nearest water tilepoint within 3000 units,
 * otherwise the map centre. Returns WC3 facing (radians).
 */
export const roshanPitFacing = (map: LoadedMap, x: number, y: number): number => {
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

const baseView = (map: LoadedMap, ground: HeightFn, team: 'sentinel' | 'scourge'): ViewPreset => {
  const fountain = find(map, (e) => e.kind === 'fountain' && e.team === team);
  const ancient = find(map, (e) => e.kind === 'ancient' && e.team === team);
  const c = mapCenter(map);
  const from = fountain ?? { x: c.x + (team === 'sentinel' ? -4000 : 4000), y: c.y + (team === 'sentinel' ? -4000 : 4000) };
  const to = ancient ?? c;
  const d = norm(to.x - from.x, to.y - from.y);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  // Stand a little to the side of the fountain→ancient line so towers/rax frame the ancient.
  const px = from.x + d.x * dist * 0.28 - d.y * 260;
  const py = from.y + d.y * dist * 0.28 + d.x * 260;
  return { position: eyeAt(map, ground, px, py), target: { x: to.x, y: to.y, z: ground(to.x, to.y) + 380 } };
};

const midView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const s1 = find(map, (e) => e.kind === 'tower' && e.team === 'sentinel' && e.lane === 'mid' && e.tier === 1);
  const u1 = find(map, (e) => e.kind === 'tower' && e.team === 'scourge' && e.lane === 'mid' && e.tier === 1);
  const c = mapCenter(map);
  const a = s1 ?? { x: c.x - 1500, y: c.y - 1500 };
  const b = u1 ?? { x: c.x + 1500, y: c.y + 1500 };
  const d = norm(b.x - a.x, b.y - a.y);
  const px = a.x - d.x * 420 + d.y * 180;
  const py = a.y - d.y * 420 - d.x * 180;
  return { position: eyeAt(map, ground, px, py, 10), target: { x: b.x, y: b.y, z: ground(b.x, b.y) + 200 } };
};

const riverView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const runes = map.data.entities.filter((e) => e.kind === 'rune_spot');
  const c = mapCenter(map);
  const r0 = runes[0] ?? c;
  const other = runes[1] ?? c;
  const d = norm(other.x - r0.x, other.y - r0.y);
  // Stand in the river toward the other rune, looking back at this rune spot and up-river.
  const px = r0.x + d.x * 850;
  const py = r0.y + d.y * 850;
  const tx = r0.x - d.x * 300;
  const ty = r0.y - d.y * 300;
  return { position: eyeAt(map, ground, px, py), target: { x: tx, y: ty, z: ground(tx, ty) + 40 } };
};

const roshanView = (map: LoadedMap, ground: HeightFn): ViewPreset => {
  const c = mapCenter(map);
  const r = find(map, (e) => e.kind === 'roshan') ?? { x: c.x - 2000, y: c.y + 2000 };
  const f = roshanPitFacing(map, r.x, r.y);
  const px = r.x + Math.cos(f) * 900 + Math.sin(f) * 150;
  const py = r.y + Math.sin(f) * 900 - Math.cos(f) * 150;
  return { position: eyeAt(map, ground, px, py, 20), target: { x: r.x, y: r.y, z: ground(r.x, r.y) + 160 } };
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
