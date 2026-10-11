// PathFinder implementation for the sim (contract: src/core/sim.ts PathFinder).
// Query pipeline: snap start/goal to walkable cells → same-component check → coarse path cache →
// direct line of sight → bounded A* for short hops / HPA* for long ones → string-pulling.
import type { PathFinder } from '../core/sim';
import type { Lane, Team, Vec2 } from '../core/types';
import { astar, octile, SearchScratch } from './astar';
import type { NavGrid } from './grid';
import { Hierarchy } from './hpa';
import { lineOfSight, lineOfSightRadius, smoothPath } from './smooth';

/** Cluster edge in cells for the hierarchical layer (16 cells = 512 units on the real map). */
const CLUSTER = 16;
/** Coarse cache key resolution in cells (4 cells = 128 units). */
const CACHE_CELL = 4;
const CACHE_MAX = 4096;
/** Expansion budgets (iteration caps) per search kind. */
const LOCAL_BUDGET = 6000;
const ABSTRACT_BUDGET = 40000;
const FALLBACK_BUDGET = 60000;
/** Search radius (cells) when snapping a blocked start/goal to the nearest walkable cell. */
const SNAP_RADIUS = 24;
/** Components smaller than this (cells) are pockets; snapping avoids them when it can. */
const MIN_ISLAND = 64;

export interface PathStats {
  requests: number;
  cacheHits: number;
  direct: number;
  local: number;
  hierarchical: number;
  fallback: number;
  failed: number;
}

export interface NavPathFinder extends PathFinder {
  readonly grid: NavGrid;
  readonly stats: PathStats;
  /**
   * Returns waypoints [from, …, goal] (start included, goal last) or null if no path exists. A blocked
   * goal (e.g. a building's centre) or one on another island is replaced by the nearest reachable cell.
   */
  findPath(from: Vec2, to: Vec2, radius: number): Vec2[] | null;
  /** Dynamic blocker (buildings): stamp on, later remove with on = false. Reference counted. */
  setBlocked(x: number, y: number, radius: number, on: boolean): void;
  /** Cached smoothed walking route along a lane, in the given team's walking direction. */
  lanePath(lane: Lane, team: Team): Vec2[];
  lineOfSight(a: Vec2, b: Vec2, radius?: number): boolean;
  /** Nearest walkable point (cell centre) within maxCells, or null. The point itself if walkable. */
  nearestWalkable(p: Vec2, maxCells?: number): Vec2 | null;
  /** True if both points are walkable and connected. */
  reachable(a: Vec2, b: Vec2): boolean;
}

export interface PathFinderOptions {
  /** Lane waypoints (MapData.lanes, ordered Sentinel → Scourge) for lanePath(). */
  lanes?: Record<Lane, Vec2[]>;
}

class GridPathFinder implements NavPathFinder {
  readonly grid: NavGrid;
  readonly stats: PathStats = { requests: 0, cacheHits: 0, direct: 0, local: 0, hierarchical: 0, fallback: 0, failed: 0 };
  private readonly hpa: Hierarchy;
  private readonly scratch: SearchScratch;
  private readonly comp: Int32Array;
  private readonly compSize: Int32Array;
  private compVersion = -1;
  private readonly cache = new Map<number, Vec2[]>();
  private cacheVersion = 0;
  private readonly lanes: Record<Lane, Vec2[]> | undefined;
  private readonly laneCache = new Map<string, Vec2[]>();
  private laneVersion = -1;
  private readonly ccols: number;
  private readonly crows: number;

  constructor(grid: NavGrid, opts: PathFinderOptions) {
    this.grid = grid;
    this.hpa = new Hierarchy(grid, CLUSTER);
    this.scratch = new SearchScratch(grid.cols * grid.rows);
    this.comp = new Int32Array(grid.cols * grid.rows);
    this.compSize = new Int32Array(grid.cols * grid.rows);
    this.lanes = opts.lanes;
    this.ccols = Math.ceil(grid.cols / CACHE_CELL);
    this.crows = Math.ceil(grid.rows / CACHE_CELL);
    this.cacheVersion = grid.version;
  }

  setBlocked(x: number, y: number, radius: number, on: boolean): void {
    this.grid.setBlocked(x, y, radius, on);
  }

  lineOfSight(a: Vec2, b: Vec2, radius = 0): boolean {
    return radius > 0 ? lineOfSightRadius(this.grid, a.x, a.y, b.x, b.y, radius) : lineOfSight(this.grid, a.x, a.y, b.x, b.y);
  }

  nearestWalkable(p: Vec2, maxCells = SNAP_RADIUS): Vec2 | null {
    this.ensureComponents();
    const c = this.snapCell(this.grid.cellX(p.x), this.grid.cellY(p.y), maxCells, -1, p, MIN_ISLAND);
    if (c < 0) return null;
    if (c === this.grid.cellAt(p.x, p.y)) return { x: p.x, y: p.y };
    return this.cellCenter(c);
  }

  reachable(a: Vec2, b: Vec2): boolean {
    const ca = this.grid.cellAt(a.x, a.y);
    const cb = this.grid.cellAt(b.x, b.y);
    if (ca < 0 || cb < 0 || this.grid.blocked[ca] !== 0 || this.grid.blocked[cb] !== 0) return false;
    this.ensureComponents();
    return this.comp[ca] === this.comp[cb];
  }

  findPath(from: Vec2, to: Vec2, radius: number): Vec2[] | null {
    const grid = this.grid;
    this.stats.requests++;
    if (grid.version !== this.cacheVersion) {
      this.cache.clear();
      this.cacheVersion = grid.version;
    }
    const fx = grid.cellX(from.x);
    const fy = grid.cellY(from.y);
    this.ensureComponents();
    let start = this.snapCell(fx, fy, SNAP_RADIUS, -1, from, MIN_ISLAND);
    if (start < 0) start = this.snapCell(fx, fy, SNAP_RADIUS, -1, from);
    if (start < 0) return this.fail();
    const startPt = start === grid.cellAt(from.x, from.y) ? from : this.cellCenter(start);
    const comp = this.comp[start]!;
    let goal = this.snapCell(grid.cellX(to.x), grid.cellY(to.y), SNAP_RADIUS, comp, to);
    if (goal < 0) return this.fail();
    const goalPt = goal === grid.cellAt(to.x, to.y) ? { x: to.x, y: to.y } : this.cellCenter(goal);

    const head = (path: Vec2[]): Vec2[] => {
      // Keep the caller's exact position as the first point (even if it was snapped out of a blocker).
      if (startPt !== from) path.unshift({ x: from.x, y: from.y });
      return path;
    };

    if (start === goal) {
      this.stats.direct++;
      return head([{ x: startPt.x, y: startPt.y }, goalPt]);
    }

    const key = this.cacheKey(start, goal, radius);
    const cached = this.cache.get(key);
    if (cached && cached.length >= 3) {
      const first = cached[1]!;
      const last = cached[cached.length - 2]!;
      if (this.lineOfSight(startPt, first, radius) && this.lineOfSight(last, goalPt, radius)) {
        this.stats.cacheHits++;
        this.cache.delete(key);
        this.cache.set(key, cached); // LRU touch
        return head([{ x: startPt.x, y: startPt.y }, ...cached.slice(1, -1).map((p) => ({ x: p.x, y: p.y })), goalPt]);
      }
    }

    if (lineOfSightRadius(grid, startPt.x, startPt.y, goalPt.x, goalPt.y, radius)) {
      this.stats.direct++;
      return head([{ x: startPt.x, y: startPt.y }, goalPt]);
    }

    let cells: number[] | null = null;
    const cols = grid.cols;
    const sx = start % cols;
    const sy = (start / cols) | 0;
    const gx = goal % cols;
    const gy = (goal / cols) | 0;
    if (octile(sx - gx, sy - gy) <= CLUSTER * 2) {
      const pad = CLUSTER;
      const res = astar(grid, this.scratch, start, goal, {
        x0: Math.max(0, Math.min(sx, gx) - pad),
        y0: Math.max(0, Math.min(sy, gy) - pad),
        x1: Math.min(cols - 1, Math.max(sx, gx) + pad),
        y1: Math.min(grid.rows - 1, Math.max(sy, gy) + pad),
      }, LOCAL_BUDGET);
      if (res.status === 'found') {
        cells = res.cells;
        this.stats.local++;
      }
    }
    if (!cells) {
      cells = this.hpa.findPath(start, goal, this.scratch, ABSTRACT_BUDGET);
      if (cells) this.stats.hierarchical++;
    }
    if (!cells) {
      const res = astar(grid, this.scratch, start, goal, { x0: 0, y0: 0, x1: cols - 1, y1: grid.rows - 1 }, FALLBACK_BUDGET);
      this.stats.fallback++;
      cells = res.cells;
      if (res.status !== 'found') {
        goal = cells[cells.length - 1]!;
        if (goal === start) return this.fail();
        const path = smoothPath(grid, cells, startPt, this.cellCenter(goal), radius);
        return head(path);
      }
    }
    const path = smoothPath(grid, cells, startPt, goalPt, radius);
    if (path.length >= 3) {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, path.map((p) => ({ x: p.x, y: p.y })));
    }
    return head(path);
  }

  lanePath(lane: Lane, team: Team): Vec2[] {
    if (!this.lanes) throw new Error('lanePath needs PathFinderOptions.lanes');
    if (this.laneVersion !== this.grid.version) {
      this.laneCache.clear();
      this.laneVersion = this.grid.version;
    }
    const key = `${lane}:${team}`;
    const hit = this.laneCache.get(key);
    if (hit) return hit;
    const pts = team === 'scourge' ? [...this.lanes[lane]].reverse() : this.lanes[lane];
    const out: Vec2[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const seg = this.findPath(pts[i]!, pts[i + 1]!, 0) ?? [pts[i]!, pts[i + 1]!];
      for (let j = out.length === 0 ? 0 : 1; j < seg.length; j++) out.push(seg[j]!);
    }
    this.laneCache.set(key, out);
    return out;
  }

  private fail(): null {
    this.stats.failed++;
    return null;
  }

  private cellCenter(c: number): Vec2 {
    const cols = this.grid.cols;
    return { x: this.grid.centerX(c % cols), y: this.grid.centerY((c / cols) | 0) };
  }

  private cacheKey(start: number, goal: number, radius: number): number {
    const cols = this.grid.cols;
    const cs = ((((start / cols) | 0) / CACHE_CELL) | 0) * this.ccols + (((start % cols) / CACHE_CELL) | 0);
    const cg = ((((goal / cols) | 0) / CACHE_CELL) | 0) * this.ccols + (((goal % cols) / CACHE_CELL) | 0);
    const bucket = radius > 16 ? 1 : 0;
    return (cs * this.ccols * this.crows + cg) * 2 + bucket;
  }

  /**
   * Nearest walkable cell to (cx, cy) by Euclidean distance to `p`, searching square rings up to maxR.
   * With comp >= 0 only cells of that connected component qualify; otherwise, with minSize > 0, only cells
   * of components at least that large (keeps units from snapping into pockets behind buildings).
   * Returns -1 if none.
   */
  private snapCell(cx: number, cy: number, maxR: number, comp: number, p: Vec2, minSize = 0): number {
    const g = this.grid;
    const ok = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return false;
      const i = y * g.cols + x;
      if (g.blocked[i] !== 0) return false;
      return comp >= 0 ? this.comp[i] === comp : minSize === 0 || this.compSize[this.comp[i]!]! >= minSize;
    };
    if (ok(cx, cy)) return cy * g.cols + cx;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
          const x = cx + dx;
          const y = cy + dy;
          if (!ok(x, y)) continue;
          const d = Math.hypot(g.centerX(x) - p.x, g.centerY(y) - p.y);
          if (d < bestD) {
            bestD = d;
            best = y * g.cols + x;
          }
        }
      }
      // A ring at Chebyshev distance r+1 can't beat a hit closer than r cells.
      if (best >= 0 && bestD <= r * g.cellSize) break;
    }
    return best;
  }

  /** 4-connected component labels of walkable cells (equivalent to 8-way without corner cutting). */
  private ensureComponents(): void {
    if (this.compVersion === this.grid.version) return;
    this.compVersion = this.grid.version;
    const { cols, rows, blocked } = this.grid;
    const comp = this.comp;
    comp.fill(-1);
    const queue = new Int32Array(cols * rows);
    let label = 0;
    for (let s = 0; s < comp.length; s++) {
      if (blocked[s] !== 0 || comp[s] !== -1) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      comp[s] = label;
      while (head < tail) {
        const u = queue[head++]!;
        const x = u % cols;
        const y = (u / cols) | 0;
        if (x > 0 && blocked[u - 1] === 0 && comp[u - 1] === -1) {
          comp[u - 1] = label;
          queue[tail++] = u - 1;
        }
        if (x < cols - 1 && blocked[u + 1] === 0 && comp[u + 1] === -1) {
          comp[u + 1] = label;
          queue[tail++] = u + 1;
        }
        if (y > 0 && blocked[u - cols] === 0 && comp[u - cols] === -1) {
          comp[u - cols] = label;
          queue[tail++] = u - cols;
        }
        if (y < rows - 1 && blocked[u + cols] === 0 && comp[u + cols] === -1) {
          comp[u + cols] = label;
          queue[tail++] = u + cols;
        }
      }
      this.compSize[label] = tail;
      label++;
    }
  }
}

/** Creates the sim's PathFinder over a nav grid (see createNavGrid). */
export const createPathFinder = (grid: NavGrid, opts: PathFinderOptions = {}): NavPathFinder => new GridPathFinder(grid, opts);
