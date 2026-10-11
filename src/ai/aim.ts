// Skillshot aiming: intercept prediction with partial lead and humanised angular error.
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/types';

/**
 * Point where a projectile fired after `delay` seconds at `speed` from `shooter` meets a target moving
 * at constant velocity. Falls back to the target's position after the delay if there's no solution.
 */
export const predictIntercept = (shooter: Vec2, target: Vec2, vel: Vec2, speed: number, delay: number): Vec2 => {
  // Target position once the projectile launches.
  const px = target.x + vel.x * delay - shooter.x;
  const py = target.y + vel.y * delay - shooter.y;
  const a = vel.x * vel.x + vel.y * vel.y - speed * speed;
  const b = 2 * (px * vel.x + py * vel.y);
  const c = px * px + py * py;
  let t: number;
  if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : 0;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { x: shooter.x + px, y: shooter.y + py };
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0) || !Number.isFinite(t)) return { x: shooter.x + px, y: shooter.y + py };
  return { x: shooter.x + px + vel.x * t, y: shooter.y + py + vel.y * t };
};

/** Approximately normal noise in [-1.5, 1.5]·scale (sum of three uniforms), deterministic via rng. */
export const noise = (rng: Rng, scale: number): number => (rng.next() + rng.next() + rng.next() - 1.5) * scale;

export interface AimParams {
  leadFactor: number;
  aimError: number;
}

/**
 * Aim point for a line skillshot: leads by `leadFactor` of the velocity estimate, then rotates the aim
 * around the shooter by a random angle so bots don't hit perfectly.
 */
export const aimSkillshot = (rng: Rng, p: AimParams, shooter: Vec2, target: Vec2, vel: Vec2, speed: number, delay: number): Vec2 => {
  const lead = { x: vel.x * p.leadFactor, y: vel.y * p.leadFactor };
  const hit = predictIntercept(shooter, target, lead, speed, delay);
  const ang = noise(rng, p.aimError);
  const dx = hit.x - shooter.x;
  const dy = hit.y - shooter.y;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return { x: shooter.x + dx * cos - dy * sin, y: shooter.y + dx * sin + dy * cos };
};

/** Shortest distance from point p to the segment a→b. */
export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};
