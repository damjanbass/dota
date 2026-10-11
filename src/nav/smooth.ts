// Grid line of sight (supercover traversal) and string-pulling path smoothing.
import type { Vec2 } from '../core/types';
import type { NavGrid } from './grid';

const EPS = 1e-9;

/**
 * Thin line of sight: true if every cell the segment touches is walkable. When the segment passes
 * exactly through a cell corner both orthogonal cells must be walkable (matches the no-corner-cutting
 * rule of the searches).
 */
export const lineOfSight = (grid: NavGrid, ax: number, ay: number, bx: number, by: number): boolean => {
  const { cols, rows, blocked, cellSize: cs } = grid;
  const fx0 = (ax - grid.originX) / cs;
  const fy0 = (ay - grid.originY) / cs;
  const fx1 = (bx - grid.originX) / cs;
  const fy1 = (by - grid.originY) / cs;
  let cx = Math.floor(fx0);
  let cy = Math.floor(fy0);
  const ex = Math.floor(fx1);
  const ey = Math.floor(fy1);
  const isBlocked = (x: number, y: number): boolean => x < 0 || y < 0 || x >= cols || y >= rows || blocked[y * cols + x] !== 0;
  if (isBlocked(cx, cy) || isBlocked(ex, ey)) return false;
  const dx = fx1 - fx0;
  const dy = fy1 - fy0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - fx0) * tDeltaX : stepX < 0 ? (fx0 - cx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - fy0) * tDeltaY : stepY < 0 ? (fy0 - cy) * tDeltaY : Infinity;
  let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      if (isBlocked(cx + stepX, cy) || isBlocked(cx, cy + stepY)) return false;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (isBlocked(cx, cy)) return false;
  }
  return true;
};

/**
 * Line of sight for a body of the given radius: the centre line plus two lines offset sideways.
 * The offset is capped below half a cell so bodies can still pass one-cell gaps.
 */
export const lineOfSightRadius = (grid: NavGrid, ax: number, ay: number, bx: number, by: number, radius: number): boolean => {
  if (!lineOfSight(grid, ax, ay, bx, by)) return false;
  const r = Math.min(radius, grid.cellSize * 0.45);
  if (r <= 0) return true;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return true;
  const ox = (-dy / len) * r;
  const oy = (dx / len) * r;
  return lineOfSight(grid, ax + ox, ay + oy, bx + ox, by + oy) && lineOfSight(grid, ax - ox, ay - oy, bx - ox, by - oy);
};

/**
 * String-pulls a cell path into waypoints. Output starts at `from` and ends at `to`; `from`/`to` must lie
 * in the first/last cell (or be their snapped replacements). Only direction changes of the cell path are
 * candidate waypoints, so every output segment is either verified by line of sight or a straight run of
 * the original path.
 */
export const smoothPath = (grid: NavGrid, cells: readonly number[], from: Vec2, to: Vec2, radius: number): Vec2[] => {
  const cols = grid.cols;
  const pts: Vec2[] = [{ x: from.x, y: from.y }];
  const n = cells.length;
  const center = (c: number): Vec2 => ({ x: grid.centerX(c % cols), y: grid.centerY((c / cols) | 0) });
  if (n > 0) pts.push(center(cells[0]!));
  for (let i = 1; i < n - 1; i++) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    const c = cells[i + 1]!;
    if (b - a !== c - b) pts.push(center(b));
  }
  if (n > 1) pts.push(center(cells[n - 1]!));
  pts.push({ x: to.x, y: to.y });

  const out: Vec2[] = [pts[0]!];
  let anchor = pts[0]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const next = pts[i + 1]!;
    if (!lineOfSightRadius(grid, anchor.x, anchor.y, next.x, next.y, radius)) {
      const p = pts[i]!;
      if (p.x !== anchor.x || p.y !== anchor.y) out.push(p);
      anchor = p;
    }
  }
  const last = pts[pts.length - 1]!;
  if (last.x !== anchor.x || last.y !== anchor.y || out.length === 1) out.push(last);
  return out;
};

/** Total length of a polyline. */
export const pathLength = (path: readonly Vec2[]): number => {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return d;
};
