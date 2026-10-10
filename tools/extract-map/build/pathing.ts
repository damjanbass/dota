// war3map.wpm → PathFlag grid, plus tree footprints (destructables are not baked into the .wpm).
import { PathFlag } from '../../../src/core/map';
import type { GridInfo } from '../../../src/core/map';
import type { DooEntry } from '../formats/doo';
import { WpmFlag } from '../formats/wpm';
import type { Wpm } from '../formats/wpm';

export const PATH_CELL = 32;

/**
 * Tree footprint in pathing cells. WC3 tree walls use a 4×4-cell (128×128) pathing texture; this is
 * cross-checked at extraction time (see `treeSpacingReport`): DotA's tree walls are laid out on a
 * 128-unit lattice, so 4×4 footprints close the walls exactly while 2×2 would leave 64-unit gaps.
 */
export const TREE_FOOTPRINT_CELLS = 4;

export const translateWpm = (wpm: Wpm): Uint8Array => {
  const out = new Uint8Array(wpm.cells.length);
  for (let i = 0; i < out.length; i++) {
    const c = wpm.cells[i]!;
    let f = 0;
    if (c & WpmFlag.NoWalk) f |= PathFlag.Unwalkable;
    if (c & WpmFlag.NoFly) f |= PathFlag.Unflyable;
    if (c & WpmFlag.NoBuild) f |= PathFlag.Unbuildable;
    // WPM stores "no water"; our Water bit means "is water".
    if (!(c & WpmFlag.NoWater)) f |= PathFlag.Water;
    out[i] = f;
  }
  return out;
};

/** ORs `bits` into a size×size cell square centred on (x, y). Returns the number of cells touched. */
export const stampSquare = (grid: Uint8Array, info: GridInfo, x: number, y: number, size: number, bits: number): number => {
  const half = (size * info.cellSize) / 2;
  const cx0 = Math.round((x - half - info.originX) / info.cellSize);
  const cy0 = Math.round((y - half - info.originY) / info.cellSize);
  let n = 0;
  for (let cy = cy0; cy < cy0 + size; cy++) {
    for (let cx = cx0; cx < cx0 + size; cx++) {
      if (cx < 0 || cy < 0 || cx >= info.cols || cy >= info.rows) continue;
      grid[cy * info.cols + cx]! |= bits;
      n++;
    }
  }
  return n;
};

export const stampTrees = (grid: Uint8Array, info: GridInfo, trees: DooEntry[]): number => {
  let cells = 0;
  for (const t of trees) {
    // Doodad flag bit 0x02 = solid (0/1 = non-solid in the .doo spec).
    if (!(t.flags & 0x02)) continue;
    cells += stampSquare(grid, info, t.x, t.y, TREE_FOOTPRINT_CELLS, PathFlag.Tree | PathFlag.Unbuildable);
  }
  return cells;
};

/** Histogram of nearest-neighbour distances between trees (rounded to 32), for footprint verification. */
export const treeSpacingReport = (trees: DooEntry[]): Map<number, number> => {
  const byCell = new Map<string, DooEntry[]>();
  const key = (x: number, y: number): string => `${Math.floor(x / 256)},${Math.floor(y / 256)}`;
  for (const t of trees) {
    const k = key(t.x, t.y);
    const list = byCell.get(k);
    if (list) list.push(t);
    else byCell.set(k, [t]);
  }
  const hist = new Map<number, number>();
  for (const t of trees) {
    let best = Infinity;
    const gx = Math.floor(t.x / 256);
    const gy = Math.floor(t.y / 256);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const o of byCell.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (o === t) continue;
          best = Math.min(best, Math.hypot(o.x - t.x, o.y - t.y));
        }
      }
    }
    if (!Number.isFinite(best)) continue;
    const b = Math.round(best / 32) * 32;
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  return hist;
};
