// Grid path-finding on the extracted pathing map. DotA creeps attack-move between a few script
// waypoints (spawn rect → lane bend dummy → enemy base) and the WC3 engine path-finds in between;
// we reproduce that with A* on the same walkability grid to trace the actual lane corridors.
import { PathFlag } from '../../../src/core/map';
import type { GridInfo } from '../../../src/core/map';
import type { Vec2 } from '../../../src/core/types';

const BLOCKED = PathFlag.Unwalkable | PathFlag.Tree;
/** Cells closer than this to an obstacle cost extra, so paths keep to the middle of corridors. */
const CLEARANCE_CELLS = 6;
const CLEARANCE_WEIGHT = 0.5;

export class NavGrid {
  readonly info: GridInfo;
  private readonly walk: Uint8Array;
  private readonly clearance: Uint8Array;

  constructor(pathing: Uint8Array, info: GridInfo) {
    this.info = info;
    const n = info.cols * info.rows;
    this.walk = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.walk[i] = pathing[i]! & BLOCKED ? 0 : 1;
    this.clearance = this.computeClearance();
  }

  /** Multi-source BFS (8-connected) distance in cells to the nearest blocked cell, capped. */
  private computeClearance(): Uint8Array {
    const { cols, rows } = this.info;
    const cap = CLEARANCE_CELLS;
    const d = new Uint8Array(cols * rows).fill(cap);
    let frontier: number[] = [];
    for (let i = 0; i < d.length; i++) {
      if (!this.walk[i]) {
        d[i] = 0;
        frontier.push(i);
      }
    }
    for (let level = 1; level < cap && frontier.length; level++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % cols;
        const y = (i - x) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (d[j]! > level) {
              d[j] = level;
              next.push(j);
            }
          }
        }
      }
      frontier = next;
    }
    return d;
  }

  cellOf(p: Vec2): number {
    const cx = Math.min(this.info.cols - 1, Math.max(0, Math.floor((p.x - this.info.originX) / this.info.cellSize)));
    const cy = Math.min(this.info.rows - 1, Math.max(0, Math.floor((p.y - this.info.originY) / this.info.cellSize)));
    return cy * this.info.cols + cx;
  }

  centerOf(cell: number): Vec2 {
    const cx = cell % this.info.cols;
    const cy = (cell - cx) / this.info.cols;
    return { x: this.info.originX + (cx + 0.5) * this.info.cellSize, y: this.info.originY + (cy + 0.5) * this.info.cellSize };
  }

  walkableAt(p: Vec2): boolean {
    const cx = Math.floor((p.x - this.info.originX) / this.info.cellSize);
    const cy = Math.floor((p.y - this.info.originY) / this.info.cellSize);
    if (cx < 0 || cy < 0 || cx >= this.info.cols || cy >= this.info.rows) return false;
    return this.walk[cy * this.info.cols + cx] === 1;
  }

  /** Nearest walkable cell (BFS), so script points that sit on a doodad still have a usable anchor. */
  nearestWalkable(cell: number): number {
    if (this.walk[cell]) return cell;
    const { cols, rows } = this.info;
    const seen = new Uint8Array(cols * rows);
    let frontier = [cell];
    seen[cell] = 1;
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % cols;
        const y = (i - x) / cols;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (seen[j]) continue;
          if (this.walk[j]) return j;
          seen[j] = 1;
          next.push(j);
        }
      }
      frontier = next;
    }
    return cell;
  }

  /** A* (8-connected, no corner cutting). Returns cell indices from start to goal, or null. */
  findPath(from: Vec2, to: Vec2): number[] | null {
    const { cols, rows } = this.info;
    const start = this.nearestWalkable(this.cellOf(from));
    const goal = this.nearestWalkable(this.cellOf(to));
    const n = cols * rows;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gx = goal % cols;
    const gy = (goal - gx) / cols;
    const h = (i: number): number => {
      const x = i % cols;
      const dx = Math.abs(x - gx);
      const dy = Math.abs((i - x) / cols - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const x = cur % cols;
      const y = (cur - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (!this.walk[j] || closed[j]) continue;
          if (dx && dy && (!this.walk[y * cols + nx] || !this.walk[ny * cols + x])) continue;
          const penalty = 1 + CLEARANCE_WEIGHT * (CLEARANCE_CELLS - this.clearance[j]!);
          const cost = g[cur]! + (dx && dy ? Math.SQRT2 : 1) * penalty;
          if (cost < g[j]!) {
            g[j] = cost;
            parent[j] = cur;
            heap.push(j, cost + h(j));
          }
        }
      }
    }
    if (parent[goal] === -1 && goal !== start) return null;
    const path: number[] = [];
    for (let c = goal; c !== -1; c = parent[c]!) path.push(c);
    return path.reverse();
  }

  /** True if every sample along a→b (every 8 units) is walkable. */
  segmentWalkable(a: Vec2, b: Vec2): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 8));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.walkableAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
    }
    return true;
  }

  /**
   * Cell path → compact polyline. Greedily extends each segment while it stays walkable and no
   * skipped path point deviates more than `tolerance` units from it.
   */
  simplify(cells: number[], tolerance = 96): Vec2[] {
    const pts = cells.map((c) => this.centerOf(c));
    if (pts.length <= 2) return pts;
    const out: Vec2[] = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let best = i + 1;
      for (let j = i + 2; j < pts.length; j++) {
        if (!this.segmentWalkable(pts[i]!, pts[j]!)) break;
        let ok = true;
        for (let k = i + 1; k < j && ok; k++) ok = distToSegment(pts[k]!, pts[i]!, pts[j]!) <= tolerance;
        if (!ok) break;
        best = j;
      }
      out.push(pts[best]!);
      i = best;
    }
    return out;
  }
}

export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

/** Distance from p to a polyline plus the arc length of the closest point along it. */
export const projectOnPolyline = (p: Vec2, line: Vec2[]): { dist: number; along: number } => {
  let best = { dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.dist) best = { dist: d, along: acc + t * len };
    acc += len;
  }
  return best;
};

class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      items[i] = items[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0]!;
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        items[i] = items[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}
