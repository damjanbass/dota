// Top-down debug render of an extracted map (tools/extract-map/out/debug.png).
import { PathFlag, TileFlag } from '../../../src/core/map';
import type { LoadedMap, MapEntityKind } from '../../../src/core/map';
import { encodePng } from './png';

type Rgb = [number, number, number];

const KIND_COLOR: Partial<Record<MapEntityKind, { color: Rgb; r: number }>> = {
  tower: { color: [255, 216, 74], r: 5 },
  barracks_melee: { color: [255, 138, 61], r: 6 },
  barracks_ranged: { color: [255, 93, 143], r: 6 },
  ancient: { color: [255, 255, 255], r: 10 },
  fountain: { color: [85, 255, 255], r: 8 },
  shop: { color: [180, 140, 255], r: 3 },
  secret_shop: { color: [224, 64, 251], r: 6 },
  side_shop: { color: [156, 39, 176], r: 6 },
  tavern: { color: [140, 140, 140], r: 3 },
  neutral_camp: { color: [255, 179, 0], r: 6 },
  rune_spot: { color: [0, 230, 118], r: 6 },
  roshan: { color: [255, 23, 68], r: 9 },
  creep_spawn: { color: [200, 200, 200], r: 4 },
  hero_spawn: { color: [0, 200, 255], r: 4 },
  other: { color: [120, 120, 120], r: 2 },
};

const TEAM_OUTLINE: Record<string, Rgb> = { sentinel: [0, 255, 0], scourge: [255, 0, 0], neutral: [0, 0, 0] };

export const renderDebugPng = (map: LoadedMap, pixelsPerCell = 2): Uint8Array => {
  const { terrain, pathing, bounds } = map.data;
  const w = pathing.cols * pixelsPerCell;
  const h = pathing.rows * pixelsPerCell;
  const img = new Uint8Array(w * h * 4);
  const worldW = pathing.cols * pathing.cellSize;
  const worldH = pathing.rows * pathing.cellSize;
  const px = (x: number): number => Math.round(((x - pathing.originX) / worldW) * w);
  const py = (y: number): number => Math.round(h - ((y - pathing.originY) / worldH) * h);
  const set = (x: number, y: number, c: Rgb): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    img[o] = c[0];
    img[o + 1] = c[1];
    img[o + 2] = c[2];
    img[o + 3] = 255;
  };

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const z of map.height) {
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = pathing.originX + ((x + 0.5) / w) * worldW;
      const wy = pathing.originY + ((h - y - 0.5) / h) * worldH;
      const tx = Math.min(terrain.cols - 1, Math.max(0, Math.round((wx - terrain.originX) / terrain.cellSize)));
      const ty = Math.min(terrain.rows - 1, Math.max(0, Math.round((wy - terrain.originY) / terrain.cellSize)));
      const ti = ty * terrain.cols + tx;
      const shade = 0.45 + 0.55 * ((map.height[ti]! - minZ) / Math.max(1, maxZ - minZ));
      let c: Rgb = [70 * shade, 130 * shade, 60 * shade];
      if (map.tileFlags[ti]! & TileFlag.Blight) c = [95 * shade, 75 * shade, 105 * shade];
      const water = map.water[ti]!;
      if (!Number.isNaN(water) && water > map.height[ti]!) c = [40, 90, 160];
      const pc = Math.floor(x / pixelsPerCell) + (pathing.rows - 1 - Math.floor(y / pixelsPerCell)) * pathing.cols;
      const pf = map.pathing[pc]!;
      if (pf & PathFlag.Tree) c = [18, 60, 24];
      else if (pf & PathFlag.Unwalkable) c = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35];
      set(x, y, [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
    }
  }

  const line = (x0: number, y0: number, x1: number, y1: number, c: Rgb): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      set(x, y, c);
      set(x + 1, y, c);
    }
  };
  const disc = (cx: number, cy: number, r: number, fill: Rgb, outline: Rgb): void => {
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r) set(cx + dx, cy + dy, fill);
        else if (d <= r + 1.2) set(cx + dx, cy + dy, outline);
      }
    }
  };

  // Playable bounds.
  const bx0 = px(bounds.minX);
  const bx1 = px(bounds.maxX);
  const by0 = py(bounds.minY);
  const by1 = py(bounds.maxY);
  const white: Rgb = [230, 230, 230];
  line(bx0, by0, bx1, by0, white);
  line(bx1, by0, bx1, by1, white);
  line(bx1, by1, bx0, by1, white);
  line(bx0, by1, bx0, by0, white);

  for (const lane of Object.values(map.data.lanes)) {
    for (let i = 0; i < lane.length - 1; i++) line(px(lane[i]!.x), py(lane[i]!.y), px(lane[i + 1]!.x), py(lane[i + 1]!.y), [255, 230, 120]);
    for (const p of lane) disc(px(p.x), py(p.y), 1, [255, 255, 255], [255, 230, 120]);
  }
  for (const e of map.data.entities) {
    const style = KIND_COLOR[e.kind];
    if (!style) continue;
    disc(px(e.x), py(e.y), style.r, style.color, TEAM_OUTLINE[e.team] ?? [0, 0, 0]);
  }
  return encodePng(w, h, img);
};
