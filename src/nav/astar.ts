// Grid searches on NavGrid: bounded A* (octile heuristic, binary heap, iteration budget) and a
// region-restricted Dijkstra used by the hierarchical layer. 8-way movement; diagonal steps may not
// cut corners (both orthogonal neighbours must be walkable), so 4-connectivity == 8-connectivity.
import { MinHeap } from './heap';
import type { NavGrid } from './grid';

const SQRT2 = Math.SQRT2;
const DIAG_EXTRA = SQRT2 - 1;
export const DX = [1, -1, 0, 0, 1, -1, 1, -1] as const;
export const DY = [0, 0, 1, -1, 1, 1, -1, -1] as const;
export const STEP_COST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2] as const;

/** Octile distance in cells. */
export const octile = (dx: number, dy: number): number => {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? ax + DIAG_EXTRA * ay : ay + DIAG_EXTRA * ax;
};

/** Reusable full-grid search buffers (generation-stamped so they never need clearing). */
export class SearchScratch {
  readonly g: Float32Array;
  readonly parent: Int32Array;
  readonly open: Uint32Array;
  readonly closed: Uint32Array;
  readonly heap = new MinHeap(4096);
  private gen = 0;

  constructor(cells: number) {
    this.g = new Float32Array(cells);
    this.parent = new Int32Array(cells);
    this.open = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
  }

  /** Starts a new search and returns its stamp. */
  begin(): number {
    if (++this.gen >= 0xfffffff0) {
      this.open.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    this.heap.clear();
    return this.gen;
  }
}

/** Inclusive cell bounds. */
export interface CellBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AStarResult {
  /** found: reached goal; partial: budget ran out or unreachable, path ends at the closest node. */
  status: 'found' | 'partial';
  /** Cell indices start → end. */
  cells: number[];
  expanded: number;
}

/**
 * Bounded A* between two walkable cells. Returns a path to the goal, or (status 'partial') to the node
 * closest to it when the budget is exhausted or the goal can't be reached inside the bounds.
 */
export const astar = (grid: NavGrid, s: SearchScratch, start: number, goal: number, b: CellBounds, budget: number): AStarResult => {
  const cols = grid.cols;
  const blocked = grid.blocked;
  const { g, parent, open, closed, heap } = s;
  const stamp = s.begin();
  const gx = goal % cols;
  const gy = (goal / cols) | 0;
  let best = start;
  let bestH = octile(start % cols - gx, ((start / cols) | 0) - gy);
  g[start] = 0;
  parent[start] = -1;
  open[start] = stamp;
  heap.push(start, bestH);
  let expanded = 0;
  let found = false;
  while (heap.size > 0) {
    const u = heap.pop();
    if (closed[u] === stamp) continue;
    closed[u] = stamp;
    if (u === goal) {
      found = true;
      break;
    }
    const ux = u % cols;
    const uy = (u / cols) | 0;
    const hu = octile(ux - gx, uy - gy);
    if (hu < bestH) {
      bestH = hu;
      best = u;
    }
    if (++expanded > budget) break;
    const gu = g[u]!;
    for (let k = 0; k < 8; k++) {
      const nx = ux + DX[k]!;
      const ny = uy + DY[k]!;
      if (nx < b.x0 || ny < b.y0 || nx > b.x1 || ny > b.y1) continue;
      const v = ny * cols + nx;
      if (blocked[v] !== 0 || closed[v] === stamp) continue;
      if (k >= 4 && (blocked[uy * cols + nx] !== 0 || blocked[ny * cols + ux] !== 0)) continue;
      const ng = gu + STEP_COST[k]!;
      if (open[v] === stamp && ng >= g[v]!) continue;
      open[v] = stamp;
      g[v] = ng;
      parent[v] = u;
      heap.push(v, ng + octile(nx - gx, ny - gy));
    }
  }
  const end = found ? goal : best;
  const cells: number[] = [];
  for (let c = end; c !== -1; c = parent[c]!) cells.push(c);
  cells.reverse();
  return { status: found ? 'found' : 'partial', cells, expanded };
};

/**
 * Dijkstra from one cell restricted to a rectangular region (x0, y0, w, h). Fills dist (Infinity when
 * unreachable) and parent (local index, -1 for the root / unreached) for every local cell.
 */
export const regionDijkstra = (
  grid: NavGrid,
  x0: number,
  y0: number,
  w: number,
  h: number,
  srcLocal: number,
  dist: Float32Array,
  parent: Int16Array,
  done: Uint8Array,
  heap: MinHeap,
): void => {
  const cols = grid.cols;
  const blocked = grid.blocked;
  const n = w * h;
  dist.fill(Infinity, 0, n);
  parent.fill(-1, 0, n);
  done.fill(0, 0, n);
  heap.clear();
  dist[srcLocal] = 0;
  heap.push(srcLocal, 0);
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u] === 1) continue;
    done[u] = 1;
    const lx = u % w;
    const ly = (u / w) | 0;
    const ux = x0 + lx;
    const uy = y0 + ly;
    const du = dist[u]!;
    for (let k = 0; k < 8; k++) {
      const nlx = lx + DX[k]!;
      const nly = ly + DY[k]!;
      if (nlx < 0 || nly < 0 || nlx >= w || nly >= h) continue;
      const nx = ux + DX[k]!;
      const ny = uy + DY[k]!;
      if (blocked[ny * cols + nx] !== 0) continue;
      if (k >= 4 && (blocked[uy * cols + nx] !== 0 || blocked[ny * cols + ux] !== 0)) continue;
      const v = nly * w + nlx;
      if (done[v] === 1) continue;
      const nd = du + STEP_COST[k]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        parent[v] = u;
        heap.push(v, nd);
      }
    }
  }
};
