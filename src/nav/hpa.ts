// Hierarchical path-finding (HPA*) over NavGrid. The grid is cut into square clusters; walkable runs on
// each shared border become "entrances" (one transition in the middle of a short run, two at the ends of
// a long one). Each cluster stores exact intra-cluster distances between its transition cells plus the
// Dijkstra trees to refine them back into cells. A query inserts start/goal into their clusters, runs A*
// (octile heuristic) over the abstract graph and refines the result into a cell path.
// Dynamic blockers mark clusters dirty; they are rebuilt lazily before the next query.
import { MinHeap } from './heap';
import { octile, regionDijkstra, type SearchScratch } from './astar';
import type { NavGrid } from './grid';

const BIT_E = 1;
const BIT_W = 2;
const BIT_N = 4;
const BIT_S = 8;
/** Runs at least this long get a transition at both ends instead of one in the middle. */
const LONG_ENTRANCE = 6;
/** Heuristic weight: ~2.5x fewer abstract expansions for ~3% longer raw paths (smoothing recovers most). */
const HW = 1.2;

interface Cluster {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Transition cells (global indices). */
  nodes: Int32Array;
  /** n×n intra-cluster distances in cells (Infinity = not connected inside the cluster). */
  dist: Float32Array;
  /** n × (w·h) Dijkstra parent trees (local indices, -1 = root / unreached). */
  trees: Int16Array;
}

export class Hierarchy {
  readonly size: number;
  readonly ncx: number;
  readonly ncy: number;
  /** Per cell: which neighbours across a cluster border it has a transition to (E/W/N/S bits). */
  readonly partner: Uint8Array;
  /** Per cell: slot in its cluster's node list, or -1. */
  readonly nodeSlot: Int16Array;
  readonly clusters: Cluster[] = [];
  lastExpanded = 0;
  private readonly grid: NavGrid;
  private readonly dirty: Uint8Array;
  private anyDirty = false;
  private readonly tmpDist: Float32Array;
  private readonly tmpParent: Int16Array;
  private readonly tmpDone: Uint8Array;
  private readonly heap = new MinHeap(512);
  // Start / goal insertion buffers.
  private readonly sDist: Float32Array;
  private readonly sParent: Int16Array;
  private readonly gDist: Float32Array;
  private readonly gParent: Int16Array;

  constructor(grid: NavGrid, size = 16) {
    this.grid = grid;
    this.size = size;
    this.ncx = Math.ceil(grid.cols / size);
    this.ncy = Math.ceil(grid.rows / size);
    const cells = grid.cols * grid.rows;
    this.partner = new Uint8Array(cells);
    this.nodeSlot = new Int16Array(cells).fill(-1);
    this.dirty = new Uint8Array(this.ncx * this.ncy);
    const area = size * size;
    this.tmpDist = new Float32Array(area);
    this.tmpParent = new Int16Array(area);
    this.tmpDone = new Uint8Array(area);
    this.sDist = new Float32Array(area);
    this.sParent = new Int16Array(area);
    this.gDist = new Float32Array(area);
    this.gParent = new Int16Array(area);
    for (let ky = 0; ky < this.ncy; ky++) {
      for (let kx = 0; kx < this.ncx; kx++) {
        const x0 = kx * size;
        const y0 = ky * size;
        this.clusters.push({
          x0,
          y0,
          w: Math.min(size, grid.cols - x0),
          h: Math.min(size, grid.rows - y0),
          nodes: new Int32Array(0),
          dist: new Float32Array(0),
          trees: new Int16Array(0),
        });
      }
    }
    for (let ky = 0; ky < this.ncy; ky++) {
      for (let kx = 0; kx < this.ncx; kx++) {
        this.buildBorderE(kx, ky);
        this.buildBorderN(kx, ky);
      }
    }
    for (let k = 0; k < this.clusters.length; k++) this.rebuildCluster(k);
    grid.onChange((x0, y0, x1, y1) => this.markDirty(x0, y0, x1, y1));
  }

  clusterOf(cell: number): number {
    const cols = this.grid.cols;
    return (((cell / cols) | 0) / this.size | 0) * this.ncx + ((cell % cols) / this.size | 0);
  }

  /** Number of abstract nodes (debug / tests). */
  nodeCount(): number {
    let n = 0;
    for (const c of this.clusters) n += c.nodes.length;
    return n;
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    // Expand by one cell: a change next to a border alters that border's transitions.
    const s = this.size;
    const kx0 = Math.max(0, ((x0 - 1) / s) | 0);
    const ky0 = Math.max(0, ((y0 - 1) / s) | 0);
    const kx1 = Math.min(this.ncx - 1, ((x1 + 1) / s) | 0);
    const ky1 = Math.min(this.ncy - 1, ((y1 + 1) / s) | 0);
    for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) this.dirty[ky * this.ncx + kx] = 1;
    this.anyDirty = true;
  }

  /** Applies pending dynamic-blocker changes. */
  refresh(): void {
    if (!this.anyDirty) return;
    this.anyDirty = false;
    const rebuild = new Uint8Array(this.clusters.length);
    for (let ky = 0; ky < this.ncy; ky++) {
      for (let kx = 0; kx < this.ncx; kx++) {
        const k = ky * this.ncx + kx;
        if (this.dirty[k] === 0) continue;
        this.dirty[k] = 0;
        this.buildBorderE(kx, ky);
        this.buildBorderN(kx, ky);
        if (kx > 0) this.buildBorderE(kx - 1, ky);
        if (ky > 0) this.buildBorderN(kx, ky - 1);
        rebuild[k] = 1;
        if (kx > 0) rebuild[k - 1] = 1;
        if (kx < this.ncx - 1) rebuild[k + 1] = 1;
        if (ky > 0) rebuild[k - this.ncx] = 1;
        if (ky < this.ncy - 1) rebuild[k + this.ncx] = 1;
      }
    }
    for (let k = 0; k < rebuild.length; k++) if (rebuild[k] === 1) this.rebuildCluster(k);
  }

  /** Border between cluster (kx, ky) and its east neighbour. */
  private buildBorderE(kx: number, ky: number): void {
    const { cols, rows, blocked } = this.grid;
    const x = (kx + 1) * this.size - 1;
    if (x + 1 >= cols) return;
    const ys = ky * this.size;
    const ye = Math.min(ys + this.size, rows);
    const p = this.partner;
    for (let y = ys; y < ye; y++) {
      p[y * cols + x] &= ~BIT_E;
      p[y * cols + x + 1] &= ~BIT_W;
    }
    const mark = (y: number): void => {
      p[y * cols + x] |= BIT_E;
      p[y * cols + x + 1] |= BIT_W;
    };
    let run = -1;
    for (let y = ys; y <= ye; y++) {
      const open = y < ye && blocked[y * cols + x] === 0 && blocked[y * cols + x + 1] === 0;
      if (open && run < 0) run = y;
      else if (!open && run >= 0) {
        this.markRun(run, y - 1, mark);
        run = -1;
      }
    }
  }

  /** Border between cluster (kx, ky) and its north neighbour. */
  private buildBorderN(kx: number, ky: number): void {
    const { cols, rows, blocked } = this.grid;
    const y = (ky + 1) * this.size - 1;
    if (y + 1 >= rows) return;
    const xs = kx * this.size;
    const xe = Math.min(xs + this.size, cols);
    const p = this.partner;
    for (let x = xs; x < xe; x++) {
      p[y * cols + x] &= ~BIT_N;
      p[(y + 1) * cols + x] &= ~BIT_S;
    }
    const mark = (x: number): void => {
      p[y * cols + x] |= BIT_N;
      p[(y + 1) * cols + x] |= BIT_S;
    };
    let run = -1;
    for (let x = xs; x <= xe; x++) {
      const open = x < xe && blocked[y * cols + x] === 0 && blocked[(y + 1) * cols + x] === 0;
      if (open && run < 0) run = x;
      else if (!open && run >= 0) {
        this.markRun(run, x - 1, mark);
        run = -1;
      }
    }
  }

  private markRun(a: number, b: number, mark: (i: number) => void): void {
    if (b - a + 1 >= LONG_ENTRANCE) {
      mark(a);
      mark(b);
    } else mark((a + b) >> 1);
  }

  private rebuildCluster(k: number): void {
    const c = this.clusters[k]!;
    const cols = this.grid.cols;
    for (const cell of c.nodes) this.nodeSlot[cell] = -1;
    const nodes: number[] = [];
    for (let ly = 0; ly < c.h; ly++) {
      for (let lx = 0; lx < c.w; lx++) {
        if (lx !== 0 && ly !== 0 && lx !== c.w - 1 && ly !== c.h - 1) continue;
        const cell = (c.y0 + ly) * cols + c.x0 + lx;
        if (this.partner[cell] !== 0) nodes.push(cell);
      }
    }
    const n = nodes.length;
    const area = c.w * c.h;
    c.nodes = Int32Array.from(nodes);
    c.dist = new Float32Array(n * n);
    c.trees = new Int16Array(n * area);
    for (let i = 0; i < n; i++) {
      const cell = nodes[i]!;
      this.nodeSlot[cell] = i;
      regionDijkstra(this.grid, c.x0, c.y0, c.w, c.h, this.localOf(c, cell), this.tmpDist, this.tmpParent, this.tmpDone, this.heap);
      c.trees.set(this.tmpParent.subarray(0, area), i * area);
      for (let j = 0; j < n; j++) c.dist[i * n + j] = this.tmpDist[this.localOf(c, nodes[j]!)]!;
    }
  }

  private localOf(c: Cluster, cell: number): number {
    const cols = this.grid.cols;
    return (((cell / cols) | 0) - c.y0) * c.w + (cell % cols) - c.x0;
  }

  private globalOf(c: Cluster, local: number): number {
    return (c.y0 + ((local / c.w) | 0)) * this.grid.cols + c.x0 + (local % c.w);
  }

  /**
   * Abstract search from start to goal (both walkable cells). Returns the refined cell path or null when
   * no path exists / the expansion budget runs out.
   */
  findPath(start: number, goal: number, s: SearchScratch, budget: number): number[] | null {
    this.refresh();
    const cols = this.grid.cols;
    const ks = this.clusterOf(start);
    const kg = this.clusterOf(goal);
    const cs = this.clusters[ks]!;
    const cg = this.clusters[kg]!;
    regionDijkstra(this.grid, cs.x0, cs.y0, cs.w, cs.h, this.localOf(cs, start), this.sDist, this.sParent, this.tmpDone, this.heap);
    regionDijkstra(this.grid, cg.x0, cg.y0, cg.w, cg.h, this.localOf(cg, goal), this.gDist, this.gParent, this.tmpDone, this.heap);

    const { g, parent, open, closed, heap } = s;
    const stamp = s.begin();
    const gx = goal % cols;
    const gy = (goal / cols) | 0;
    let gu = 0;
    let u = start;
    const relax = (v: number, w: number): void => {
      if (w === Infinity || closed[v] === stamp) return;
      const ng = gu + w;
      if (open[v] === stamp && ng >= g[v]!) return;
      open[v] = stamp;
      g[v] = ng;
      parent[v] = u;
      heap.push(v, ng + HW * octile(v % cols - gx, ((v / cols) | 0) - gy));
    };
    g[start] = 0;
    parent[start] = -1;
    open[start] = stamp;
    heap.push(start, octile(start % cols - gx, ((start / cols) | 0) - gy));
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      u = heap.pop();
      if (closed[u] === stamp) continue;
      closed[u] = stamp;
      if (u === goal) {
        found = true;
        break;
      }
      if (++expanded > budget) break;
      gu = g[u]!;
      if (u === start) {
        for (let j = 0; j < cs.nodes.length; j++) relax(cs.nodes[j]!, this.sDist[this.localOf(cs, cs.nodes[j]!)]!);
        if (ks === kg) relax(goal, this.sDist[this.localOf(cs, goal)]!);
      }
      const slot = this.nodeSlot[u]!;
      if (slot >= 0) {
        const k = this.clusterOf(u);
        const c = this.clusters[k]!;
        const n = c.nodes.length;
        for (let j = 0; j < n; j++) if (j !== slot) relax(c.nodes[j]!, c.dist[slot * n + j]!);
        const bits = this.partner[u]!;
        if (bits & BIT_E) relax(u + 1, 1);
        if (bits & BIT_W) relax(u - 1, 1);
        if (bits & BIT_N) relax(u + cols, 1);
        if (bits & BIT_S) relax(u - cols, 1);
        if (k === kg) relax(goal, this.gDist[this.localOf(cg, u)]!);
      }
    }
    this.lastExpanded = expanded;
    if (!found) return null;

    const seq: number[] = [];
    for (let c = goal; c !== -1; c = parent[c]!) seq.push(c);
    seq.reverse();
    return this.refine(seq, start, goal, ks, kg);
  }

  private refine(seq: number[], start: number, goal: number, ks: number, kg: number): number[] {
    const out: number[] = [start];
    const cs = this.clusters[ks]!;
    const cg = this.clusters[kg]!;
    const tmp: number[] = [];
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i]!;
      const b = seq[i + 1]!;
      const ka = this.clusterOf(a);
      if (ka !== this.clusterOf(b)) {
        out.push(b); // transition step across a border
        continue;
      }
      tmp.length = 0;
      if (a === start) {
        // Walk the start tree back from b.
        for (let l = this.localOf(cs, b); l !== -1; l = this.sParent[l]!) tmp.push(this.globalOf(cs, l));
        for (let j = tmp.length - 2; j >= 0; j--) out.push(tmp[j]!);
      } else if (b === goal) {
        // The goal tree's parent chain from a leads to the goal.
        for (let l = this.gParent[this.localOf(cg, a)]!; l !== -1; l = this.gParent[l]!) out.push(this.globalOf(cg, l));
      } else {
        const c = this.clusters[ka]!;
        const area = c.w * c.h;
        const base = this.nodeSlot[a]! * area;
        for (let l = this.localOf(c, b); l !== -1; l = c.trees[base + l]!) tmp.push(this.globalOf(c, l));
        for (let j = tmp.length - 2; j >= 0; j--) out.push(tmp[j]!);
      }
    }
    return out;
  }
}
