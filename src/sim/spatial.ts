// Uniform-grid spatial hash over unit feet positions. Rebuilt once per tick (O(n)); queries walk only the cells that
// overlap the query circle. Units are referenced by object, so removing a unit from the sim never corrupts the hash.
import type { SimUnit } from './types';

export class SpatialHash {
  private readonly cols: number;
  private readonly rows: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly inv: number;
  private readonly head: Int32Array;
  private next = new Int32Array(256);
  private items: SimUnit[] = [];
  private count = 0;

  constructor(bounds: { minX: number; minY: number; maxX: number; maxY: number }, cellSize = 256) {
    const pad = cellSize * 2;
    this.originX = bounds.minX - pad;
    this.originY = bounds.minY - pad;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX + pad * 2) / cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY + pad * 2) / cellSize));
    this.inv = 1 / cellSize;
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
  }

  private cellX(x: number): number {
    const c = Math.floor((x - this.originX) * this.inv);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cellY(y: number): number {
    const r = Math.floor((y - this.originY) * this.inv);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  rebuild(units: readonly SimUnit[]): void {
    this.head.fill(-1);
    const n = units.length;
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, this.next.length * 2));
    if (this.items.length < n) this.items.length = n;
    this.count = n;
    for (let i = 0; i < n; i++) {
      const u = units[i]!;
      this.items[i] = u;
      const cell = this.cellY(u.position.y) * this.cols + this.cellX(u.position.x);
      this.next[i] = this.head[cell]!;
      this.head[cell] = i;
    }
  }

  /** Appends units whose feet are within `radius` of (x, y) to `out` (dead units included). Returns `out`. */
  queryInto(x: number, y: number, radius: number, out: SimUnit[]): SimUnit[] {
    const c0 = this.cellX(x - radius);
    const c1 = this.cellX(x + radius);
    const r0 = this.cellY(y - radius);
    const r1 = this.cellY(y + radius);
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        let i = this.head[r * this.cols + c]!;
        while (i >= 0) {
          const u = this.items[i]!;
          if (!u.removed) {
            const dx = u.position.x - x;
            const dy = u.position.y - y;
            if (dx * dx + dy * dy <= r2) out.push(u);
          }
          i = this.next[i]!;
        }
      }
    }
    return out;
  }

  get size(): number {
    return this.count;
  }
}
