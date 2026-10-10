// MapData contract: produced by tools/extract-map (real .w3x) or createMockMap(), consumed by
// world (rendering), player (collision), sim, nav and ui (minimap). Owned by Lead.
import type { Lane, Team, Tier, Vec2 } from './types';

/** Bits in the pathing grid (one byte per 32×32 cell). NOTE: our Water bit means "is water" (WPM stores the inverse). */
export const PathFlag = {
  Unwalkable: 0x02,
  Unflyable: 0x04,
  Unbuildable: 0x08,
  /** Cell is blocked by a tree (separate bit so trees can be destroyed later). */
  Tree: 0x10,
  Water: 0x40,
} as const;

/** Bits in the per-tilepoint flag grid (decoded from w3e). */
export const TileFlag = {
  Ramp: 0x01,
  Blight: 0x02,
  Water: 0x04,
  Boundary: 0x08,
} as const;

export type MapEntityKind =
  | 'tower'
  | 'barracks_melee'
  | 'barracks_ranged'
  | 'ancient'
  | 'fountain'
  | 'shop'
  | 'secret_shop'
  | 'side_shop'
  | 'tavern'
  | 'neutral_camp'
  | 'rune_spot'
  | 'roshan'
  | 'creep_spawn'
  | 'hero_spawn'
  | 'other';

export interface MapEntity {
  id: number;
  kind: MapEntityKind;
  team: Team;
  lane?: Lane;
  tier?: Tier;
  x: number;
  y: number;
  z: number;
  /** Radians, WC3 convention (0 = east, CCW). */
  facing: number;
  /** Raw 4-char WC3 type id ('' for synthetic markers). */
  typeId: string;
  /** Name from war3map.w3u / WC3 data when known. */
  name: string;
  /** Extra info, e.g. neutral camp size ('small' | 'medium' | 'large' | 'ancient'). */
  meta?: Record<string, string | number>;
}

export interface MapTreeType {
  typeId: string;
  name: string;
  /** Drives which tree model the renderer uses. */
  style: 'ashenvale' | 'blight' | 'northrend' | 'other';
}

export interface MapDoodad {
  typeId: string;
  x: number;
  y: number;
  z: number;
  facing: number;
  scale: number;
}

export interface GridInfo {
  /** Samples in X / Y. Row-major, row 0 = south (min Y), column 0 = west (min X). */
  cols: number;
  rows: number;
  /** World position of sample (0,0). */
  originX: number;
  originY: number;
  /** Distance between samples (terrain: 128 per tilepoint, pathing: 32 per cell). */
  cellSize: number;
}

export interface MapData {
  version: 1;
  /** e.g. 'DotA v6.83d.w3x' or 'mock'. */
  source: string;
  /** Playable area (camera bounds). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Terrain tilepoint grid (cols = tiles + 1). */
  terrain: GridInfo & {
    /** WC3 ground tile ids in texture-index order, e.g. ['Adrt', 'Agrs', ...]. */
    groundTextures: string[];
    /** Primary tileset char from w3e header, e.g. 'A' (Ashenvale). */
    tileset: string;
  };
  pathing: GridInfo;
  /** Binary file names relative to map.json. */
  files: {
    height: string; // Float32 per tilepoint: final ground Z incl. cliff layers
    water: string; // Float32 per tilepoint: water surface Z, NaN = no water
    texture: string; // Uint8 per tilepoint: index into terrain.groundTextures
    cliffLayer: string; // Uint8 per tilepoint: WC3 layer height
    tileFlags: string; // Uint8 per tilepoint: TileFlag bits
    pathing: string; // Uint8 per pathing cell: PathFlag bits (terrain + trees + static doodads; NOT buildings)
  };
  treeTypes: MapTreeType[];
  /** One tuple per tree: [x, y, z, scale, treeTypeIndex, variation]. */
  trees: Array<[number, number, number, number, number, number]>;
  /** Non-tree decorative doodads (rocks, ruins, ...). */
  doodads: MapDoodad[];
  entities: MapEntity[];
  /** Lane waypoints ordered Sentinel base → Scourge base (Scourge creeps walk them reversed). */
  lanes: Record<Lane, Vec2[]>;
}

export interface LoadedMap {
  data: MapData;
  height: Float32Array;
  water: Float32Array;
  texture: Uint8Array;
  cliffLayer: Uint8Array;
  tileFlags: Uint8Array;
  pathing: Uint8Array;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const fetchBinary = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
};

/** Loads the extracted map from /data/map.json (+ binaries next to it). */
export const loadMap = async (baseUrl = '/data/'): Promise<LoadedMap> => {
  const res = await fetch(`${baseUrl}map.json`);
  if (!res.ok) throw new Error(`No extracted map at ${baseUrl}map.json`);
  const data = (await res.json()) as MapData;
  const [height, water, texture, cliffLayer, tileFlags, pathing] = await Promise.all([
    fetchBinary(baseUrl + data.files.height),
    fetchBinary(baseUrl + data.files.water),
    fetchBinary(baseUrl + data.files.texture),
    fetchBinary(baseUrl + data.files.cliffLayer),
    fetchBinary(baseUrl + data.files.tileFlags),
    fetchBinary(baseUrl + data.files.pathing),
  ]);
  return {
    data,
    height: new Float32Array(height),
    water: new Float32Array(water),
    texture: new Uint8Array(texture),
    cliffLayer: new Uint8Array(cliffLayer),
    tileFlags: new Uint8Array(tileFlags),
    pathing: new Uint8Array(pathing),
  };
};

/** Real map if extracted, otherwise the procedural mock (so every module runs before extraction works). */
export const loadMapOrMock = async (): Promise<LoadedMap> => {
  try {
    return await loadMap();
  } catch {
    const { createMockMap } = await import('./mockMap');
    return createMockMap();
  }
};

// ---------------------------------------------------------------------------
// Queries (pure; safe to use from sim, nav, player and world)
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Bilinear ground height (Z) at world (x, y). Clamped to the grid edge. */
export const groundHeightAt = (map: LoadedMap, x: number, y: number): number => {
  const t = map.data.terrain;
  const fx = clamp((x - t.originX) / t.cellSize, 0, t.cols - 1.0001);
  const fy = clamp((y - t.originY) / t.cellSize, 0, t.rows - 1.0001);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const h = map.height;
  const i00 = iy * t.cols + ix;
  const a = h[i00]! + (h[i00 + 1]! - h[i00]!) * tx;
  const b = h[i00 + t.cols]! + (h[i00 + t.cols + 1]! - h[i00 + t.cols]!) * tx;
  return a + (b - a) * ty;
};

/** Water surface Z at (x, y), or NaN if the nearest tilepoint has no water. */
export const waterHeightAt = (map: LoadedMap, x: number, y: number): number => {
  const t = map.data.terrain;
  const ix = clamp(Math.round((x - t.originX) / t.cellSize), 0, t.cols - 1);
  const iy = clamp(Math.round((y - t.originY) / t.cellSize), 0, t.rows - 1);
  return map.water[iy * t.cols + ix]!;
};

/** Pathing cell index for world (x, y), or -1 outside the grid. */
export const pathCellIndex = (map: LoadedMap, x: number, y: number): number => {
  const p = map.data.pathing;
  const cx = Math.floor((x - p.originX) / p.cellSize);
  const cy = Math.floor((y - p.originY) / p.cellSize);
  if (cx < 0 || cy < 0 || cx >= p.cols || cy >= p.rows) return -1;
  return cy * p.cols + cx;
};

/** PathFlag bits at (x, y). Outside the grid counts as unwalkable. */
export const pathingAt = (map: LoadedMap, x: number, y: number): number => {
  const i = pathCellIndex(map, x, y);
  return i < 0 ? PathFlag.Unwalkable | PathFlag.Unflyable : map.pathing[i]!;
};

export const isWalkable = (map: LoadedMap, x: number, y: number): boolean =>
  (pathingAt(map, x, y) & (PathFlag.Unwalkable | PathFlag.Tree)) === 0;

export const entitiesOfKind = (map: LoadedMap, kind: MapEntityKind, team?: Team): MapEntity[] =>
  map.data.entities.filter((e) => e.kind === kind && (team === undefined || e.team === team));
