// Fog of war: per-team visibility recomputed every TUNABLES.visionInterval. A unit is visible to a team when any
// living unit of that team has it inside its (scaled, day/night) vision radius with line of sight. Trees block
// sight on a coarse 64-unit grid built from PathFlag.Tree; WC3 high ground applies (a viewer can't see a target on a
// higher cliff level). Invisible units are only seen inside a true-sight radius (towers, ancients, fountains).
import { PathFlag, TileFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import { TUNABLES } from './tunables';
import { TEAM_BIT, TEAM_INDEX } from './types';
import type { SimUnit } from './types';
import type { World } from './world';

const TREE_CELL = 64;
const LOS_STEP = 48;
/** Ignore blockers this close to the viewer / target (units stand next to trees). */
const LOS_END_SKIP = 64;

export class VisionGrid {
  private readonly tree: Uint8Array;
  private readonly tcols: number;
  private readonly trows: number;
  private readonly tox: number;
  private readonly toy: number;
  private readonly viewLvl: Uint8Array;
  private readonly tgtLvl: Uint8Array;
  private readonly lcols: number;
  private readonly lrows: number;
  private readonly lox: number;
  private readonly loy: number;
  private readonly lcell: number;
  readonly hasCliffs: boolean;

  constructor(map: LoadedMap) {
    const p = map.data.pathing;
    const ratio = Math.max(1, Math.round(TREE_CELL / p.cellSize));
    this.tcols = Math.ceil(p.cols / ratio);
    this.trows = Math.ceil(p.rows / ratio);
    this.tox = p.originX;
    this.toy = p.originY;
    this.tree = new Uint8Array(this.tcols * this.trows);
    for (let cy = 0; cy < p.rows; cy++) {
      for (let cx = 0; cx < p.cols; cx++) {
        if (map.pathing[cy * p.cols + cx]! & PathFlag.Tree) {
          this.tree[Math.floor(cy / ratio) * this.tcols + Math.floor(cx / ratio)] = 1;
        }
      }
    }

    const t = map.data.terrain;
    this.lcols = t.cols - 1;
    this.lrows = t.rows - 1;
    this.lox = t.originX;
    this.loy = t.originY;
    this.lcell = t.cellSize;
    this.viewLvl = new Uint8Array(this.lcols * this.lrows);
    this.tgtLvl = new Uint8Array(this.lcols * this.lrows);
    let minL = 255;
    let maxL = 0;
    for (let ty = 0; ty < this.lrows; ty++) {
      for (let tx = 0; tx < this.lcols; tx++) {
        const i00 = ty * t.cols + tx;
        const corners = [i00, i00 + 1, i00 + t.cols, i00 + t.cols + 1];
        let lo = 255;
        let hi = 0;
        let ramp = false;
        for (const c of corners) {
          const l = map.cliffLayer[c]!;
          if (l < lo) lo = l;
          if (l > hi) hi = l;
          if (map.tileFlags[c]! & TileFlag.Ramp) ramp = true;
        }
        const i = ty * this.lcols + tx;
        this.viewLvl[i] = Math.min(255, hi + (ramp && TUNABLES.rampSeesUp ? 1 : 0));
        this.tgtLvl[i] = lo;
        minL = Math.min(minL, lo);
        maxL = Math.max(maxL, hi);
      }
    }
    this.hasCliffs = maxL > minL;
  }

  private tile(x: number, y: number): number {
    let tx = Math.floor((x - this.lox) / this.lcell);
    let ty = Math.floor((y - this.loy) / this.lcell);
    tx = tx < 0 ? 0 : tx >= this.lcols ? this.lcols - 1 : tx;
    ty = ty < 0 ? 0 : ty >= this.lrows ? this.lrows - 1 : ty;
    return ty * this.lcols + tx;
  }

  /** Cliff level a viewer standing at (x, y) sees from. */
  viewerLevel(x: number, y: number): number {
    return this.viewLvl[this.tile(x, y)]!;
  }

  /** Cliff level a target standing at (x, y) is on. */
  targetLevel(x: number, y: number): number {
    return this.tgtLvl[this.tile(x, y)]!;
  }

  isTree(x: number, y: number): boolean {
    const cx = Math.floor((x - this.tox) / TREE_CELL);
    const cy = Math.floor((y - this.toy) / TREE_CELL);
    if (cx < 0 || cy < 0 || cx >= this.tcols || cy >= this.trows) return false;
    return this.tree[cy * this.tcols + cx] === 1;
  }

  /** Trees between a and b (the ends themselves are ignored). */
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const end = len - LOS_END_SKIP;
    if (end <= LOS_END_SKIP) return true;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = LOS_END_SKIP; d <= end; d += LOS_STEP) {
      const cx = Math.floor((ax + ux * d - this.tox) / TREE_CELL);
      const cy = Math.floor((ay + uy * d - this.toy) / TREE_CELL);
      if (cx < 0 || cy < 0 || cx >= this.tcols || cy >= this.trows) continue;
      if (this.tree[cy * this.tcols + cx] === 1) return false;
    }
    return true;
  }

  /** WC3 high ground + tree line of sight (no radius check). */
  sightClear(viewer: SimUnit, target: SimUnit): boolean {
    const v = viewer.position;
    const t = target.position;
    if (this.hasCliffs && viewer.extra?.moveType !== 'fly' && this.targetLevel(t.x, t.y) > this.viewerLevel(v.x, v.y)) return false;
    return this.lineOfSight(v.x, v.y, t.x, t.y);
  }
}

export const isInvisible = (u: SimUnit): boolean => {
  for (const b of u.buffs) if (b.invisible) return true;
  return false;
};

const canSee = (w: World, viewer: SimUnit, target: SimUnit, invisible: boolean): boolean => {
  const dx = target.position.x - viewer.position.x;
  const dy = target.position.y - viewer.position.y;
  const d2 = dx * dx + dy * dy;
  if (invisible && !(viewer.trueSight > 0 && d2 <= viewer.trueSight * viewer.trueSight)) return false;
  const r = w.unitStats(viewer).vision;
  if (d2 > r * r) return false;
  return w.vision.sightClear(viewer, target);
};

const viewersByTeam: [SimUnit[], SimUnit[], SimUnit[]] = [[], [], []];

/** Recomputes SimUnit.visMask for every unit. */
export const recomputeVision = (w: World): void => {
  for (const list of viewersByTeam) list.length = 0;
  const units = w.unitList;
  for (const u of units) if (u.alive && !u.removed) viewersByTeam[TEAM_INDEX[u.team]].push(u);

  for (const u of units) {
    if (!u.alive) {
      u.visMask = 0;
      continue;
    }
    const own = TEAM_INDEX[u.team];
    let mask = TEAM_BIT[u.team];
    const invisible = isInvisible(u);
    for (let ti = 0; ti < 3; ti++) {
      if (ti === own) continue;
      const list = viewersByTeam[ti as 0 | 1 | 2];
      let seen = false;
      const lastId = u.seenBy[ti as 0 | 1 | 2];
      if (lastId) {
        const last = w.byId.get(lastId);
        if (last && last.alive && canSee(w, last, u, invisible)) seen = true;
      }
      if (!seen) {
        for (const v of list) {
          if (v.id === lastId) continue;
          if (canSee(w, v, u, invisible)) {
            u.seenBy[ti as 0 | 1 | 2] = v.id;
            seen = true;
            break;
          }
        }
      }
      if (seen) mask |= 1 << ti;
      else u.seenBy[ti as 0 | 1 | 2] = 0;
    }
    u.visMask = mask;
  }
};
