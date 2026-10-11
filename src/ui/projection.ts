// Screen projection + culling for overhead bars and damage numbers. Pure math on a column-major
// view-projection matrix (three.js Matrix4.elements), covered by ui.healthbars.test.ts.

export interface ScreenPoint {
  x: number;
  y: number;
  /** Clip-space w = distance along the view direction (world units). */
  depth: number;
}

/** Near limit: anything closer than this (or behind the camera) is culled. */
const MIN_DEPTH = 1;

/**
 * Projects a three.js-space point with a view-projection matrix to CSS pixels.
 * Returns false (and leaves `out` undefined-ish) when the point is behind the camera or further than
 * `margin` (in NDC units, e.g. 0.1 = 10% of half the screen) outside the viewport.
 */
export const projectToScreen = (
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: ScreenPoint,
  margin = 0.1,
): boolean => {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (w < MIN_DEPTH) return false;
  const cx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
  const cy = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
  const lim = 1 + margin;
  if (cx < -lim || cx > lim || cy < -lim || cy > lim) return false;
  out.x = (cx + 1) * 0.5 * width;
  out.y = (1 - cy) * 0.5 * height;
  out.depth = w;
  return true;
};

/**
 * Opacity for an overhead bar by apparent distance (distance × zoom factor, so scoped targets far
 * away still show their bars): fully opaque until `near`, fading out by `far`.
 */
export const distanceFade = (apparentDistance: number, near = 1600, far = 3200): number => {
  if (apparentDistance <= near) return 1;
  if (apparentDistance >= far) return 0;
  return 1 - (apparentDistance - near) / (far - near);
};

/**
 * Keeps the `cap` nearest candidates: sorts `order` (indices into `depth`) by depth and truncates.
 * Returns the number kept. `order` is reused between frames to avoid allocations.
 */
export const selectNearest = (depth: ArrayLike<number>, count: number, cap: number, order: number[]): number => {
  order.length = count;
  for (let i = 0; i < count; i++) order[i] = i;
  if (count <= cap) return count;
  order.sort((a, b) => depth[a]! - depth[b]!);
  order.length = cap;
  return cap;
};

/** Ally creeps under this HP fraction can be denied (DotA 6.83d: below 50%). */
export const DENY_THRESHOLD = 0.5;

export const isDeniable = (hp: number, maxHp: number): boolean => maxHp > 0 && hp / maxHp < DENY_THRESHOLD;
