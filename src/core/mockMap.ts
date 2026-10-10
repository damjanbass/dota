// Procedural stand-in with the same SHAPE as DotA (Sentinel bottom-left, Scourge top-right,
// 3 lanes, diagonal river, jungles). Used until tools/extract-map produces the real 6.83d data,
// and by unit tests as a deterministic fixture. Not an attempt at the real layout.
import { createRng } from './rng';
import { PathFlag, TileFlag } from './map';
import type { LoadedMap, MapData, MapEntity, MapEntityKind } from './map';
import type { Lane, Team, Tier, Vec2 } from './types';

const TILES = 96;
const TILE = 128;
const HALF = (TILES * TILE) / 2;
const COLS = TILES + 1;
const PCELL = 32;
const PCOLS = (TILES * TILE) / PCELL;
const WATER_Z = -40;

const LANES: Record<Lane, Vec2[]> = {
  top: [
    { x: -4300, y: -3700 },
    { x: -5200, y: -2600 },
    { x: -5200, y: 5200 },
    { x: 2600, y: 5200 },
    { x: 3700, y: 4300 },
  ],
  mid: [
    { x: -3900, y: -3900 },
    { x: 3900, y: 3900 },
  ],
  bot: [
    { x: -3700, y: -4300 },
    { x: -2600, y: -5200 },
    { x: 5200, y: -5200 },
    { x: 5200, y: 2600 },
    { x: 4300, y: 3700 },
  ],
};

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

const distToLanes = (p: Vec2): number => {
  let best = Infinity;
  for (const lane of Object.values(LANES)) {
    for (let i = 0; i < lane.length - 1; i++) best = Math.min(best, distToSegment(p, lane[i]!, lane[i + 1]!));
  }
  return best;
};

/** Point at fraction t (0..1) of a polyline's length, plus the unit direction there. */
const along = (line: Vec2[], t: number): { p: Vec2; dir: Vec2 } => {
  const lens = line.slice(1).map((b, i) => Math.hypot(b.x - line[i]!.x, b.y - line[i]!.y));
  let d = lens.reduce((s, l) => s + l, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (d <= lens[i]! || i === lens.length - 1) {
      const f = Math.min(1, d / lens[i]!);
      return {
        p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
        dir: { x: (b.x - a.x) / lens[i]!, y: (b.y - a.y) / lens[i]! },
      };
    }
    d -= lens[i]!;
  }
  return { p: line[0]!, dir: { x: 1, y: 0 } };
};

const riverDist = (x: number, y: number): number => Math.abs(x + y) / Math.SQRT2;
const baseDist = (x: number, y: number): number =>
  Math.min(Math.hypot(x + 5400, y + 5400), Math.hypot(x - 5400, y - 5400));

const heightAt = (x: number, y: number): number => {
  let h = 22 * Math.sin(x / 650) * Math.cos(y / 800) + 10 * Math.sin((x - y) / 310);
  h *= smoothstep(300, 520, distToLanes({ x, y }));
  h = -90 + (h + 90) * smoothstep(250, 700, riverDist(x, y));
  const b = baseDist(x, y);
  h = 48 + (h - 48) * smoothstep(2000, 2600, b);
  return h;
};

export const createMockMap = (): LoadedMap => {
  const rng = createRng(6830);
  const origin = -HALF;
  const bounds = { minX: -HALF + 256, minY: -HALF + 256, maxX: HALF - 256, maxY: HALF - 256 };

  // --- Terrain tilepoints -------------------------------------------------
  const n = COLS * COLS;
  const height = new Float32Array(n);
  const water = new Float32Array(n);
  const texture = new Uint8Array(n);
  const cliffLayer = new Uint8Array(n).fill(2);
  const tileFlags = new Uint8Array(n);
  for (let iy = 0; iy < COLS; iy++) {
    for (let ix = 0; ix < COLS; ix++) {
      const i = iy * COLS + ix;
      const x = origin + ix * TILE;
      const y = origin + iy * TILE;
      const h = heightAt(x, y);
      const scourge = x + y > 0;
      const lane = distToLanes({ x, y }) < 330;
      height[i] = h;
      water[i] = riverDist(x, y) < 480 ? WATER_Z : NaN;
      texture[i] = h < WATER_Z ? 4 : (scourge ? 2 : 0) + (lane ? 1 : 0);
      tileFlags[i] =
        (Number.isNaN(water[i]!) ? 0 : TileFlag.Water) |
        (scourge && riverDist(x, y) > 300 ? TileFlag.Blight : 0) |
        (ix < 2 || iy < 2 || ix > COLS - 3 || iy > COLS - 3 ? TileFlag.Boundary : 0);
    }
  }

  // --- Entities -----------------------------------------------------------
  const entities: MapEntity[] = [];
  const add = (kind: MapEntityKind, team: Team, x: number, y: number, extra: Partial<MapEntity> = {}): void => {
    entities.push({ id: entities.length + 1, kind, team, x, y, z: heightAt(x, y), facing: 0, typeId: '', name: kind, ...extra });
  };
  const mirror = (team: Team, x: number, y: number): [number, number] => (team === 'sentinel' ? [x, y] : [-x, -y]);

  for (const team of ['sentinel', 'scourge'] as const) {
    add('fountain', team, ...mirror(team, -5650, -5650));
    add('hero_spawn', team, ...mirror(team, -5550, -5550));
    add('ancient', team, ...mirror(team, -4750, -4750));
    add('tower', team, ...mirror(team, -4350, -4850), { tier: 4 });
    add('tower', team, ...mirror(team, -4850, -4350), { tier: 4 });
    for (const [sx, sy] of [[-5300, -4950], [-4950, -5300], [-5550, -4700]] as const) add('shop', team, ...mirror(team, sx, sy));
    add('secret_shop', team, ...mirror(team, -1900, -900));
    add('side_shop', team, ...mirror(team, team === 'sentinel' ? -4600 : 4600, team === 'sentinel' ? 2400 : -2400));

    for (const lane of ['top', 'mid', 'bot'] as const) {
      const line = LANES[lane];
      const f = (t: number): number => (team === 'sentinel' ? t : 1 - t);
      const tiers: Array<[Tier, number]> = [[3, 0.1], [2, 0.25], [1, 0.4]];
      for (const [tier, t] of tiers) {
        const { p } = along(line, f(t));
        add('tower', team, p.x, p.y, { lane, tier });
      }
      const { p: rp, dir } = along(line, f(0.045));
      add('barracks_melee', team, rp.x - dir.y * 230, rp.y + dir.x * 230, { lane });
      add('barracks_ranged', team, rp.x + dir.y * 230, rp.y - dir.x * 230, { lane });
      const { p: sp } = along(line, f(0.02));
      add('creep_spawn', team, sp.x, sp.y, { lane });
    }

    const camps: Array<[number, number, string]> = [
      [0, -3300, 'medium'],
      [1500, -3500, 'small'],
      [-1200, -2600, 'large'],
      [-3500, 0, 'medium'],
      [-3600, 1400, 'large'],
      [2700, -3700, 'ancient'],
    ];
    for (const [cx, cy, size] of camps) add('neutral_camp', 'neutral', ...mirror(team, cx, cy), { meta: { size } });
  }
  add('rune_spot', 'neutral', -1800, 1800);
  add('rune_spot', 'neutral', 1800, -1800);
  add('roshan', 'neutral', -2400, 2700);

  // --- Trees ----------------------------------------------------------------
  const clearings = entities.map((e) => ({ x: e.x, y: e.y, r: e.kind === 'neutral_camp' ? 380 : 300 }));
  const trees: MapData['trees'] = [];
  for (let k = 0; k < 14000 && trees.length < 3200; k++) {
    const x = rng.range(-HALF + 128, HALF - 128);
    const y = rng.range(-HALF + 128, HALF - 128);
    const edge = Math.min(x - -HALF, HALF - x, y - -HALF, HALF - y);
    const isBorder = edge < 520;
    if (!isBorder) {
      if (distToLanes({ x, y }) < 430 || riverDist(x, y) < 420 || baseDist(x, y) < 2500) continue;
      if (clearings.some((c) => Math.hypot(c.x - x, c.y - y) < c.r)) continue;
      if (!rng.chance(0.55)) continue;
    }
    trees.push([x, y, heightAt(x, y), rng.range(0.85, 1.2), x + y > 0 ? 1 : 0, rng.int(0, 9)]);
  }

  // --- Pathing --------------------------------------------------------------
  const pathing = new Uint8Array(PCOLS * PCOLS);
  for (let cy = 0; cy < PCOLS; cy++) {
    for (let cx = 0; cx < PCOLS; cx++) {
      const x = origin + (cx + 0.5) * PCELL;
      const y = origin + (cy + 0.5) * PCELL;
      let f = 0;
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
        f |= PathFlag.Unwalkable | PathFlag.Unflyable | PathFlag.Unbuildable;
      }
      if (riverDist(x, y) < 480) f |= PathFlag.Water | PathFlag.Unbuildable;
      pathing[cy * PCOLS + cx] = f;
    }
  }
  for (const [tx, ty] of trees) {
    const r = 64;
    for (let cy = Math.floor((ty - r - origin) / PCELL); cy <= Math.floor((ty + r - origin) / PCELL); cy++) {
      for (let cx = Math.floor((tx - r - origin) / PCELL); cx <= Math.floor((tx + r - origin) / PCELL); cx++) {
        if (cx < 0 || cy < 0 || cx >= PCOLS || cy >= PCOLS) continue;
        const px = origin + (cx + 0.5) * PCELL;
        const py = origin + (cy + 0.5) * PCELL;
        if (Math.hypot(px - tx, py - ty) <= r) pathing[cy * PCOLS + cx]! |= PathFlag.Tree | PathFlag.Unbuildable;
      }
    }
  }

  const data: MapData = {
    version: 1,
    source: 'mock',
    bounds,
    terrain: {
      cols: COLS,
      rows: COLS,
      originX: origin,
      originY: origin,
      cellSize: TILE,
      groundTextures: ['Agrs', 'Adrt', 'Ngrs', 'Ndrt', 'Arck'],
      tileset: 'A',
    },
    pathing: { cols: PCOLS, rows: PCOLS, originX: origin, originY: origin, cellSize: PCELL },
    files: {
      height: 'height.bin',
      water: 'water.bin',
      texture: 'texture.bin',
      cliffLayer: 'cliff.bin',
      tileFlags: 'tileflags.bin',
      pathing: 'pathing.bin',
    },
    treeTypes: [
      { typeId: 'ATtr', name: 'Ashenvale Tree', style: 'ashenvale' },
      { typeId: 'NTtw', name: 'Blighted Tree', style: 'blight' },
    ],
    trees,
    doodads: [],
    entities,
    lanes: LANES,
  };

  return { data, height, water, texture, cliffLayer, tileFlags, pathing };
};
