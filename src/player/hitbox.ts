// Hitscan geometry: rays vs unit capsules + head spheres, the terrain heightfield, tree trunks and building cylinders.
// All in WC3 coordinates. Ray directions must be unit length; every `t` is a distance along the ray.
import { groundHeightAt } from '../core/map';
import type { LoadedMap, MapData } from '../core/map';
import type { HitPart, Hittable, ShotResult, Vec3 } from '../core/types';
import { clamp } from './math';

const MISS = Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------
// Primitive intersections
// ---------------------------------------------------------------------------

/** Entry distance of a ray into a sphere, 0 if the origin is inside, Infinity on a miss. */
export const raySphere = (o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number => {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return MISS;
  const disc = b * b - c;
  if (disc < 0) return MISS;
  return -b - Math.sqrt(disc);
};

/**
 * Entry distance into the side of a vertical cylinder of radius r spanning z ∈ [z0, z1], ignoring its flat caps.
 * Returns 0 if the origin is inside the cylinder.
 */
const rayCylinderSide = (o: Vec3, d: Vec3, cx: number, cy: number, z0: number, z1: number, r: number): number => {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return o.z >= z0 && o.z <= z1 ? 0 : MISS;
  const a = d.x * d.x + d.y * d.y;
  if (a < 1e-12) return MISS;
  const b = ox * d.x + oy * d.y;
  if (b >= 0) return MISS;
  const disc = b * b - a * c;
  if (disc < 0) return MISS;
  const t = (-b - Math.sqrt(disc)) / a;
  const z = o.z + t * d.z;
  return z >= z0 && z <= z1 ? t : MISS;
};

/** Entry distance into an upright capsule whose segment runs from (cx, cy, z0) to (cx, cy, z1). */
export const rayVerticalCapsule = (o: Vec3, d: Vec3, cx: number, cy: number, z0: number, z1: number, r: number): number =>
  // First entry into a union = min of first entries into its parts (side + two end spheres).
  Math.min(rayCylinderSide(o, d, cx, cy, z0, z1, r), raySphere(o, d, cx, cy, z0, r), raySphere(o, d, cx, cy, z1, r));

/**
 * Solid vertical cylinder from zBase to zTop (tree trunk, building). The bottom cap is ignored (it is underground).
 * A ray starting inside returns Infinity: the shooter is never blocked by the volume they stand in.
 */
export const rayVerticalCylinder = (o: Vec3, d: Vec3, cx: number, cy: number, zBase: number, zTop: number, r: number): number => {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const r2 = r * r;
  if (ox * ox + oy * oy <= r2 && o.z >= zBase && o.z <= zTop) return MISS;
  let best = rayCylinderSide(o, d, cx, cy, zBase, zTop, r);
  if (o.z > zTop && d.z < 0) {
    const t = (zTop - o.z) / d.z;
    const px = ox + d.x * t;
    const py = oy + d.y * t;
    if (px * px + py * py <= r2 && t < best) best = t;
  }
  return best;
};

// ---------------------------------------------------------------------------
// Unit hitboxes
// ---------------------------------------------------------------------------

/** Hitbox shape as stored on a Hittable. */
export interface HitboxShape {
  bodyRadius: number;
  bodyHeight: number;
  headRadius: number;
}

/** Tuning for hitboxFor(). Fractions of the unit's collision radius / height. */
export const HITBOX_TUNING = {
  /** Body capsule radius as a fraction of the WC3 collision radius (collision circles are wider than torsos). */
  bodyRadiusScale: 0.75,
  /** Head radius as a fraction of total height... */
  headHeightFraction: 0.1,
  /** ...but never wider than this fraction of the body radius. */
  headMaxBodyFraction: 0.8,
  minHeadRadius: 3,
  minBodyRadius: 4,
} as const;

/** Body + head sizes for a unit of the given collision radius and total height (feet → top of head). */
export const hitboxFor = ({ collisionRadius, height }: { collisionRadius: number; height: number }): HitboxShape => {
  const t = HITBOX_TUNING;
  const bodyRadius = Math.max(t.minBodyRadius, collisionRadius * t.bodyRadiusScale);
  const headRadius = clamp(height * t.headHeightFraction, t.minHeadRadius, Math.max(t.minHeadRadius, bodyRadius * t.headMaxBodyFraction));
  const bodyHeight = Math.max(headRadius, height - 2 * headRadius);
  return { bodyRadius, bodyHeight, headRadius };
};

/** Z of the head-sphere centre for a Hittable. */
export const headCenterZ = (h: Hittable): number => h.position.z + h.bodyHeight + h.headRadius;

/** Two hits closer than this (units) count as "the same distance"; the head then wins. */
export const HEAD_PRIORITY_EPSILON = 1;

/** Picks head or body from their entry distances (Infinity = missed). Head wins ties within HEAD_PRIORITY_EPSILON. */
export const resolveHitPart = (tHead: number, tBody: number): { part: HitPart | null; t: number } => {
  if (tHead === MISS && tBody === MISS) return { part: null, t: MISS };
  if (tHead <= tBody + HEAD_PRIORITY_EPSILON) return { part: 'head', t: tHead };
  return { part: 'body', t: tBody };
};

/** Entry distances of a ray into a Hittable's head sphere and body capsule (Infinity = miss). */
export const rayHittable = (o: Vec3, d: Vec3, h: Hittable, out: { tHead: number; tBody: number }): void => {
  const { x, y, z } = h.position;
  out.tHead = raySphere(o, d, x, y, z + h.bodyHeight + h.headRadius, h.headRadius);
  let r = h.bodyRadius;
  let z0 = z + r;
  let z1 = z + h.bodyHeight - r;
  if (z1 < z0) {
    // Short body: degenerate capsule → sphere filling the body height.
    r = Math.min(r, h.bodyHeight / 2);
    z0 = z1 = z + h.bodyHeight / 2;
  }
  out.tBody = rayVerticalCapsule(o, d, x, y, z0, z1, r);
};

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** Upper bound of |∇ground| used to size safe raymarch steps (WC3 cliffs: ~1 layer of 128 per 128-unit tile). */
const TERRAIN_MAX_SLOPE = 3;
const TERRAIN_MIN_STEP = 4;
const TERRAIN_MAX_STEP = 256;

/**
 * Raymarches the bilinear heightfield. Steps are as large as the slope bound allows, then the crossing is
 * refined by bisection. Returns the hit distance or Infinity.
 */
export const traceTerrain = (map: LoadedMap, o: Vec3, d: Vec3, maxDist: number): number => {
  const horiz = Math.hypot(d.x, d.y);
  const slopeRate = TERRAIN_MAX_SLOPE * horiz + Math.max(0, -d.z);
  let prevT = 0;
  let t = 0;
  for (;;) {
    const h = o.z + d.z * t - groundHeightAt(map, o.x + d.x * t, o.y + d.y * t);
    if (h <= 0) {
      if (t === 0) return 0;
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        const hm = o.z + d.z * mid - groundHeightAt(map, o.x + d.x * mid, o.y + d.y * mid);
        if (hm > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    if (t >= maxDist) return MISS;
    const step = slopeRate > 1e-9 ? clamp(h / slopeRate, TERRAIN_MIN_STEP, TERRAIN_MAX_STEP) : TERRAIN_MAX_STEP;
    prevT = t;
    t = Math.min(maxDist, t + step);
  }
};

/** Terrain normal (WC3 axes) at (x, y) by central differences. */
export const terrainNormal = (map: LoadedMap, x: number, y: number, out: Vec3): Vec3 => {
  const e = 16;
  const dzdx = (groundHeightAt(map, x + e, y) - groundHeightAt(map, x - e, y)) / (2 * e);
  const dzdy = (groundHeightAt(map, x, y + e) - groundHeightAt(map, x, y - e)) / (2 * e);
  const len = Math.hypot(dzdx, dzdy, 1);
  out.x = -dzdx / len;
  out.y = -dzdy / len;
  out.z = 1 / len;
  return out;
};

// ---------------------------------------------------------------------------
// Trees (spatial hash + 2D DDA)
// ---------------------------------------------------------------------------

export const TREE_TRUNK_RADIUS = 24;
export const TREE_TRUNK_HEIGHT = 250;

/** Uniform grid over tree trunks. Build once per map; `raycast` walks only the cells the ray crosses. */
export class TreeGrid {
  readonly count: number;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly zs: Float32Array;
  private readonly rs: Float32Array;
  private readonly hs: Float32Array;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    trees: MapData['trees'],
    private readonly cellSize = 256,
    radius = TREE_TRUNK_RADIUS,
    height = TREE_TRUNK_HEIGHT,
  ) {
    const n = trees.length;
    this.count = n;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.zs = new Float32Array(n);
    this.rs = new Float32Array(n);
    this.hs = new Float32Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x, y, z, scale] = trees[i]!;
      const s = scale > 0 ? scale : 1;
      this.xs[i] = x;
      this.ys[i] = y;
      this.zs[i] = z;
      this.rs[i] = radius * s;
      this.hs[i] = height * s;
      minX = Math.min(minX, x - this.rs[i]!);
      minY = Math.min(minY, y - this.rs[i]!);
      maxX = Math.max(maxX, x + this.rs[i]!);
      maxY = Math.max(maxY, y + this.rs[i]!);
    }
    if (n === 0) minX = minY = maxX = maxY = 0;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);

    // CSR layout: count per cell, prefix sum, fill. A trunk is registered in every cell its bounding box touches.
    const counts = new Int32Array(this.cols * this.rows + 1);
    this.forEachCell(n, (cell) => counts[cell]!++);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    for (let c = 0; c < this.cols * this.rows; c++) this.cellStart[c + 1] = this.cellStart[c]! + counts[c]!;
    this.cellItems = new Int32Array(this.cellStart[this.cols * this.rows]!);
    const fill = this.cellStart.slice(0, this.cols * this.rows);
    this.forEachCell(n, (cell, i) => {
      this.cellItems[fill[cell]!++] = i;
    });
  }

  private forEachCell(n: number, fn: (cell: number, tree: number) => void): void {
    const cs = this.cellSize;
    for (let i = 0; i < n; i++) {
      const r = this.rs[i]!;
      const c0 = Math.floor((this.xs[i]! - r - this.minX) / cs);
      const c1 = Math.floor((this.xs[i]! + r - this.minX) / cs);
      const r0 = Math.floor((this.ys[i]! - r - this.minY) / cs);
      const r1 = Math.floor((this.ys[i]! + r - this.minY) / cs);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) fn(cy * this.cols + cx, i);
    }
  }

  /** Nearest trunk hit within maxDist, or null. `out.index` is the index into map.data.trees. */
  raycast(o: Vec3, d: Vec3, maxDist: number, out: { t: number; index: number }): boolean {
    out.t = MISS;
    out.index = -1;
    if (this.count === 0) return false;
    const cs = this.cellSize;
    const maxX = this.minX + this.cols * cs;
    const maxY = this.minY + this.rows * cs;

    // Clip the ray to the grid rectangle (2D slab test).
    let t0 = 0;
    let t1 = maxDist;
    if (Math.abs(d.x) < 1e-12) {
      if (o.x < this.minX || o.x > maxX) return false;
    } else {
      const a = (this.minX - o.x) / d.x;
      const b = (maxX - o.x) / d.x;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (Math.abs(d.y) < 1e-12) {
      if (o.y < this.minY || o.y > maxY) return false;
    } else {
      const a = (this.minY - o.y) / d.y;
      const b = (maxY - o.y) / d.y;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 > t1) return false;

    let cx = clamp(Math.floor((o.x + d.x * t0 - this.minX) / cs), 0, this.cols - 1);
    let cy = clamp(Math.floor((o.y + d.y * t0 - this.minY) / cs), 0, this.rows - 1);
    const stepX = d.x > 0 ? 1 : -1;
    const stepY = d.y > 0 ? 1 : -1;
    const dX = Math.abs(d.x) < 1e-12 ? MISS : Math.abs(cs / d.x);
    const dY = Math.abs(d.y) < 1e-12 ? MISS : Math.abs(cs / d.y);
    let tMaxX = Math.abs(d.x) < 1e-12 ? MISS : (this.minX + (cx + (d.x > 0 ? 1 : 0)) * cs - o.x) / d.x;
    let tMaxY = Math.abs(d.y) < 1e-12 ? MISS : (this.minY + (cy + (d.y > 0 ? 1 : 0)) * cs - o.y) / d.y;

    for (;;) {
      const cell = cy * this.cols + cx;
      for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
        const i = this.cellItems[k]!;
        const z = this.zs[i]!;
        const t = rayVerticalCylinder(o, d, this.xs[i]!, this.ys[i]!, z, z + this.hs[i]!, this.rs[i]!);
        if (t < out.t && t <= maxDist) {
          out.t = t;
          out.index = i;
        }
      }
      const exit = Math.min(tMaxX, tMaxY);
      if (out.t <= exit || exit > t1) break;
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += dX;
        if (cx < 0 || cx >= this.cols) break;
      } else {
        cy += stepY;
        tMaxY += dY;
        if (cy < 0 || cy >= this.rows) break;
      }
    }
    return out.index >= 0;
  }

  /** Trunk centre of tree i (for impact normals). */
  trunkCenter(i: number, out: { x: number; y: number }): void {
    out.x = this.xs[i]!;
    out.y = this.ys[i]!;
  }
}

// ---------------------------------------------------------------------------
// castShot
// ---------------------------------------------------------------------------

/** Solid cylinder that stops shots (buildings). z is the base height. */
export interface ShotBlocker {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

export interface ShotWorld {
  map?: LoadedMap;
  trees?: TreeGrid;
  buildings?: readonly ShotBlocker[];
}

const scratchHit = { tHead: MISS, tBody: MISS };
const scratchTree = { t: MISS, index: -1 };

/**
 * Hitscan from `origin` along unit `dir`. Finds the nearest living target (head beats body on ties), then checks
 * whether terrain, a tree trunk or a building is closer. `ignoreId` skips the shooter.
 */
export const castShot = (
  origin: Vec3,
  dir: Vec3,
  maxRange: number,
  targets: Iterable<Hittable>,
  world: ShotWorld = {},
  ignoreId?: number,
): ShotResult => {
  let bestT = MISS;
  let bestId: number | null = null;
  let bestPart: HitPart | null = null;

  for (const h of targets) {
    if (!h.alive || h.id === ignoreId) continue;
    // Cheap reject: horizontal distance from the ray line to the unit axis.
    const reach = Math.max(h.bodyRadius, h.headRadius);
    const px = h.position.x - origin.x;
    const py = h.position.y - origin.y;
    const along = px * dir.x + py * dir.y;
    const horiz2 = dir.x * dir.x + dir.y * dir.y;
    if (horiz2 > 1e-9) {
      const perp2 = px * px + py * py - (along * along) / horiz2;
      if (perp2 > reach * reach) continue;
    }
    rayHittable(origin, dir, h, scratchHit);
    const { part, t } = resolveHitPart(scratchHit.tHead, scratchHit.tBody);
    if (part === null || t > maxRange) continue;
    const better = t < bestT - HEAD_PRIORITY_EPSILON || (t <= bestT + HEAD_PRIORITY_EPSILON && part === 'head' && bestPart !== 'head') || (bestPart === part && t < bestT);
    if (better) {
      bestT = t;
      bestId = h.id;
      bestPart = part;
    }
  }

  const limit = Math.min(maxRange, bestT);
  let blockT = MISS;
  let blockedBy: ShotResult['blockedBy'] = null;
  if (world.map) {
    const t = traceTerrain(world.map, origin, dir, limit);
    if (t < blockT) {
      blockT = t;
      blockedBy = 'terrain';
    }
  }
  if (world.trees && world.trees.raycast(origin, dir, Math.min(limit, blockT), scratchTree) && scratchTree.t < blockT) {
    blockT = scratchTree.t;
    blockedBy = 'tree';
  }
  if (world.buildings) {
    for (const b of world.buildings) {
      const t = rayVerticalCylinder(origin, dir, b.x, b.y, b.z, b.z + b.height, b.radius);
      if (t < blockT && t <= limit) {
        blockT = t;
        blockedBy = 'building';
      }
    }
  }

  let t: number;
  let result: ShotResult;
  if (blockT < bestT) {
    t = blockT;
    result = { targetId: null, part: null, point: { x: 0, y: 0, z: 0 }, distance: t, blockedBy };
  } else if (bestId !== null) {
    t = bestT;
    result = { targetId: bestId, part: bestPart, point: { x: 0, y: 0, z: 0 }, distance: t, blockedBy: null };
  } else {
    t = maxRange;
    result = { targetId: null, part: null, point: { x: 0, y: 0, z: 0 }, distance: t, blockedBy: 'range' };
  }
  result.point.x = origin.x + dir.x * t;
  result.point.y = origin.y + dir.y * t;
  result.point.z = origin.z + dir.z * t;
  return result;
};
