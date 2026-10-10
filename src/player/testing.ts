// Tiny synthetic LoadedMap builder for player unit tests and integration checks. Not used at runtime.
import { PathFlag } from '../core/map';
import type { LoadedMap, MapData } from '../core/map';

export interface TestMapOptions {
  /** Half extent in units (map spans -half..half on both axes). */
  half?: number;
  height?: (x: number, y: number) => number;
  /** Pathing flags per cell centre (default: walkable everywhere inside a 1-cell unwalkable border). */
  pathing?: (x: number, y: number) => number;
  trees?: MapData['trees'];
}

export const createTestMap = (opts: TestMapOptions = {}): LoadedMap => {
  const half = opts.half ?? 2048;
  const tile = 128;
  const cell = 32;
  const cols = (2 * half) / tile + 1;
  const pcols = (2 * half) / cell;
  const heightFn = opts.height ?? ((): number => 0);
  const height = new Float32Array(cols * cols);
  for (let iy = 0; iy < cols; iy++) {
    for (let ix = 0; ix < cols; ix++) height[iy * cols + ix] = heightFn(-half + ix * tile, -half + iy * tile);
  }
  const pathing = new Uint8Array(pcols * pcols);
  for (let cy = 0; cy < pcols; cy++) {
    for (let cx = 0; cx < pcols; cx++) {
      const border = cx === 0 || cy === 0 || cx === pcols - 1 || cy === pcols - 1;
      const x = -half + (cx + 0.5) * cell;
      const y = -half + (cy + 0.5) * cell;
      pathing[cy * pcols + cx] = (border ? PathFlag.Unwalkable : 0) | (opts.pathing?.(x, y) ?? 0);
    }
  }
  const n = cols * cols;
  const data: MapData = {
    version: 1,
    source: 'test',
    bounds: { minX: -half, minY: -half, maxX: half, maxY: half },
    terrain: { cols, rows: cols, originX: -half, originY: -half, cellSize: tile, groundTextures: ['Agrs'], tileset: 'A' },
    pathing: { cols: pcols, rows: pcols, originX: -half, originY: -half, cellSize: cell },
    files: { height: '', water: '', texture: '', cliffLayer: '', tileFlags: '', pathing: '' },
    treeTypes: [{ typeId: 'ATtr', name: 'Ashenvale Tree', style: 'ashenvale' }],
    trees: opts.trees ?? [],
    doodads: [],
    entities: [],
    lanes: { top: [], mid: [], bot: [] },
  };
  return {
    data,
    height,
    water: new Float32Array(n).fill(Number.NaN),
    texture: new Uint8Array(n),
    cliffLayer: new Uint8Array(n),
    tileFlags: new Uint8Array(n),
    pathing,
  };
};
