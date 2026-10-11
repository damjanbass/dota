// Walkability grid for navigation, built from the map's pathing cells (32 units on the real map).
// Static blocking = terrain/cliffs/water-deep (PathFlag.Unwalkable) + trees (PathFlag.Tree) + cells
// outside the playable bounds. Dynamic blockers (buildings) are reference-counted per cell so the sim
// can stamp and later remove them in any order.
import { PathFlag } from '../core/map';
import type { LoadedMap } from '../core/map';

type ChangeListener = (x0: number, y0: number, x1: number, y1: number) => void;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
  /** 1 = blocked (static or any dynamic blocker). Hot-path array: read directly. */
  readonly blocked: Uint8Array;
  private readonly staticBlocked: Uint8Array;
  private readonly dynamic: Uint8Array;
  private listeners: ChangeListener[] = [];
  /** Bumped on every change so caches can detect staleness. */
  version = 0;

  constructor(cols: number, rows: number, originX: number, originY: number, cellSize: number, staticBlocked: Uint8Array) {
    this.cols = cols;
    this.rows = rows;
    this.originX = originX;
    this.originY = originY;
    this.cellSize = cellSize;
    this.staticBlocked = staticBlocked;
    this.blocked = staticBlocked.slice();
    this.dynamic = new Uint8Array(cols * rows);
  }

  cellX(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  cellY(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  /** Cell index for world (x, y), or -1 outside the grid. */
  cellAt(x: number, y: number): number {
    const cx = this.cellX(x);
    const cy = this.cellY(y);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  centerX(cx: number): number {
    return this.originX + (cx + 0.5) * this.cellSize;
  }

  centerY(cy: number): number {
    return this.originY + (cy + 0.5) * this.cellSize;
  }

  isWalkableCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.blocked[cy * this.cols + cx] === 0;
  }

  isWalkable(x: number, y: number): boolean {
    return this.isWalkableCell(this.cellX(x), this.cellY(y));
  }

  /** True if the cell is blocked by terrain/trees (ignores dynamic blockers). */
  isStaticBlocked(cell: number): boolean {
    return this.staticBlocked[cell] === 1;
  }

  /** Number of dynamic blockers stamped on a cell. */
  dynamicCount(cell: number): number {
    return this.dynamic[cell]!;
  }

  /**
   * Stamp (on = true) or remove (on = false) a circular dynamic blocker. Cells whose centre lies inside
   * the circle are affected; the containing cell always is. Stamps are reference counted.
   */
  setBlocked(x: number, y: number, radius: number, on: boolean): void {
    const cs = this.cellSize;
    const x0 = Math.max(0, this.cellX(x - radius));
    const y0 = Math.max(0, this.cellY(y - radius));
    const x1 = Math.min(this.cols - 1, this.cellX(x + radius));
    const y1 = Math.min(this.rows - 1, this.cellY(y + radius));
    const own = this.cellAt(x, y);
    const r2 = radius * radius;
    let changed = false;
    for (let cy = y0; cy <= y1; cy++) {
      const dy = this.originY + (cy + 0.5) * cs - y;
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * this.cols + cx;
        const dx = this.originX + (cx + 0.5) * cs - x;
        if (i !== own && dx * dx + dy * dy > r2) continue;
        const before = this.dynamic[i]!;
        const after = on ? Math.min(255, before + 1) : Math.max(0, before - 1);
        this.dynamic[i] = after;
        const b = this.staticBlocked[i]! | (after > 0 ? 1 : 0);
        if (b !== this.blocked[i]) {
          this.blocked[i] = b;
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.version++;
    for (const fn of this.listeners) fn(x0, y0, x1, y1);
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

/** Builds the nav grid from the map's pathing layer. Cells outside the playable bounds are blocked. */
export const createNavGrid = (map: LoadedMap): NavGrid => {
  const p = map.data.pathing;
  const { minX, minY, maxX, maxY } = map.data.bounds;
  const blocked = new Uint8Array(p.cols * p.rows);
  const mask = PathFlag.Unwalkable | PathFlag.Tree;
  for (let cy = 0; cy < p.rows; cy++) {
    const wy = p.originY + (cy + 0.5) * p.cellSize;
    const outY = wy < minY || wy > maxY;
    for (let cx = 0; cx < p.cols; cx++) {
      const i = cy * p.cols + cx;
      const wx = p.originX + (cx + 0.5) * p.cellSize;
      blocked[i] = outY || wx < minX || wx > maxX || (map.pathing[i]! & mask) !== 0 ? 1 : 0;
    }
  }
  return new NavGrid(p.cols, p.rows, p.originX, p.originY, p.cellSize, blocked);
};
