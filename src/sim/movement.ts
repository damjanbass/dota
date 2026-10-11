// Ground movement: straight lines (or the registered PathFinder for longer trips), walkability sliding, and a simple
// separation pass so creeps don't stack.
import { groundHeightAt, isWalkable } from '../core/map';
import { TUNABLES } from './tunables';
import type { SimUnit } from './types';
import type { World } from './world';

/** Moves `u` to (x, y) on walkable ground (axis-sliding along walls). Returns false if fully blocked. */
export const stepTo = (w: World, u: SimUnit, x: number, y: number): boolean => {
  const p = u.position;
  const map = w.map;
  if (u.extra?.moveType === 'fly' || isWalkable(map, x, y) || !isWalkable(map, p.x, p.y)) {
    p.x = x;
    p.y = y;
  } else if (isWalkable(map, x, p.y)) {
    p.x = x;
  } else if (isWalkable(map, p.x, y)) {
    p.y = y;
  } else {
    return false;
  }
  p.z = groundHeightAt(map, p.x, p.y);
  return true;
};

const needsRepath = (w: World, u: SimUnit, gx: number, gy: number): boolean => {
  if (!u.path) return w.time - u.pathAt >= TUNABLES.repathInterval || u.pathAt === -Infinity;
  const dx = gx - u.pathGoalX;
  const dy = gy - u.pathGoalY;
  const moved2 = dx * dx + dy * dy;
  if (moved2 > 400 * 400) return true;
  return moved2 > 96 * 96 && w.time - u.pathAt >= TUNABLES.repathInterval;
};

/**
 * One tick of movement toward (gx, gy), stopping `stopDist` short. Uses the PathFinder (if registered) for goals
 * farther than TUNABLES.straightLineDistance. Returns true once within `stopDist`.
 */
export const moveTo = (w: World, u: SimUnit, gx: number, gy: number, dt: number, stopDist: number): boolean => {
  const p = u.position;
  let dx = gx - p.x;
  let dy = gy - p.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= stopDist * stopDist) return true;
  const speed = w.unitStats(u).moveSpeed;
  if (speed <= 0) return false;

  let tx = gx;
  let ty = gy;
  let direct = true;
  const pf = w.pathFinder;
  if (pf && d2 > TUNABLES.straightLineDistance * TUNABLES.straightLineDistance) {
    if (needsRepath(w, u, gx, gy)) {
      u.path = pf.findPath({ x: p.x, y: p.y }, { x: gx, y: gy }, Math.max(u.def.collisionRadius, 8));
      u.pathIndex = 0;
      u.pathGoalX = gx;
      u.pathGoalY = gy;
      u.pathAt = w.time;
    }
    const path = u.path;
    if (path) {
      while (u.pathIndex < path.length) {
        const q = path[u.pathIndex]!;
        const qx = q.x - p.x;
        const qy = q.y - p.y;
        if (qx * qx + qy * qy > 24 * 24) break;
        u.pathIndex++;
      }
      if (u.pathIndex < path.length) {
        tx = path[u.pathIndex]!.x;
        ty = path[u.pathIndex]!.y;
        direct = false;
      }
    }
  } else if (u.path) {
    u.path = null;
  }

  dx = tx - p.x;
  dy = ty - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return direct;
  let step = speed * dt;
  if (direct) step = Math.min(step, Math.sqrt(d2) - stopDist);
  else step = Math.min(step, d);
  if (step <= 0) return true;
  u.facing = Math.atan2(dy, dx);
  if (stepTo(w, u, p.x + (dx / d) * step, p.y + (dy / d) * step)) u.moved = true;
  return false;
};

const sepScratch: SimUnit[] = [];
const MAX_STATIC_RADIUS = 200;
const MAX_PUSH_PER_TICK = 10;

const isStatic = (v: SimUnit): boolean => v.isBuilding || v.behaviour === 'player' || v.def.moveSpeed <= 0;

/** Pushes overlapping units apart. Only units that moved or are attacking this tick are processed. */
export const separate = (w: World): void => {
  const minR = TUNABLES.separationMinRadius;
  for (const u of w.unitList) {
    if (!u.alive || isStatic(u) || (!u.moved && u.attackPhase === 0)) continue;
    const ru = Math.max(u.def.collisionRadius, minR);
    const px = u.position.x;
    const py = u.position.y;
    sepScratch.length = 0;
    w.queryInto(px, py, ru + MAX_STATIC_RADIUS, sepScratch);
    let pushX = 0;
    let pushY = 0;
    for (const v of sepScratch) {
      if (v === u || !v.alive) continue;
      const rv = Math.max(v.def.collisionRadius, minR);
      let dx = px - v.position.x;
      let dy = py - v.position.y;
      const minD = ru + rv;
      const dd = dx * dx + dy * dy;
      if (dd >= minD * minD) continue;
      let d = Math.sqrt(dd);
      if (d < 1e-3) {
        // Exactly stacked: split deterministically by id.
        const a = (u.id * 2.399963) % (Math.PI * 2);
        dx = Math.cos(a);
        dy = Math.sin(a);
        d = 1;
      }
      const share = isStatic(v) ? 1 : 0.5;
      const overlap = (minD - d) * share;
      pushX += (dx / d) * overlap;
      pushY += (dy / d) * overlap;
    }
    sepScratch.length = 0;
    if (pushX === 0 && pushY === 0) continue;
    const len = Math.sqrt(pushX * pushX + pushY * pushY);
    if (len > MAX_PUSH_PER_TICK) {
      pushX *= MAX_PUSH_PER_TICK / len;
      pushY *= MAX_PUSH_PER_TICK / len;
    }
    stepTo(w, u, px + pushX, py + pushY);
  }
};
