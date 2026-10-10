// Pure GoldSrc / Counter-Strike 1.6 movement math (pm_shared.c), in WC3 units (1 unit ≈ 1 inch, same as GoldSrc).
// Every function mutates the passed velocity in place so the controller allocates nothing per tick.
import type { Vec2 } from '../core/types';

export interface MoveParams {
  /** sv_accelerate. */
  accelerate: number;
  /** sv_airaccelerate. */
  airAccelerate: number;
  /** sv_friction. */
  friction: number;
  /** sv_stopspeed: friction acts as if speed were at least this. */
  stopSpeed: number;
  /** sv_gravity (units/s²). */
  gravity: number;
  /** Initial upward velocity of a jump: sqrt(2 · 800 · 45) ≈ 268.3 → 45-unit jump. */
  jumpVelocity: number;
  /** PM_AirAccelerate caps the wish speed to 30 for the add-speed test (what makes air-strafing work). */
  airSpeedCap: number;
  /** Shift-walk multiplier on max speed (cl_movespeedkey). */
  walkMultiplier: number;
  /**
   * CS 1.6 jump stamina (pmove->fuser2, ms). Jumping again or walking while it is > 0 scales velocity down,
   * which is the "landing slowdown" that stops bunny-hopping. 0 disables it.
   */
  jumpStaminaMs: number;
  /** Max ground drop per substep that still counts as walking down a slope (GoldSrc STEPSIZE). */
  stepDown: number;
}

export const MOVE_DEFAULTS: Readonly<MoveParams> = {
  accelerate: 5,
  airAccelerate: 10,
  friction: 4,
  stopSpeed: 100,
  gravity: 800,
  jumpVelocity: Math.sqrt(2 * 800 * 45),
  airSpeedCap: 30,
  walkMultiplier: 0.52,
  jumpStaminaMs: 1315.789429,
  stepDown: 18,
};

/** Sniper base move speed (plan / DotA 6.83d). The live value comes from stats at runtime. */
export const DEFAULT_MAX_SPEED = 290;

/** CS 1.6 AWP: 210 unscoped → 150 scoped. Same ratio applied to Sniper's move speed while scoped. */
export const SCOPED_SPEED_MULTIPLIER = 150 / 210;

/** PM_Friction (ground only). */
export const applyFriction = (vel: Vec2, dt: number, friction = MOVE_DEFAULTS.friction, stopSpeed = MOVE_DEFAULTS.stopSpeed): void => {
  const speed = Math.hypot(vel.x, vel.y);
  if (speed < 0.1) {
    vel.x = 0;
    vel.y = 0;
    return;
  }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const newSpeed = Math.max(0, speed - control * friction * dt) / speed;
  vel.x *= newSpeed;
  vel.y *= newSpeed;
};

/** PM_Accelerate. (wishX, wishY) must be a unit vector or zero. */
export const accelerate = (vel: Vec2, wishX: number, wishY: number, wishSpeed: number, accel: number, dt: number): void => {
  const current = vel.x * wishX + vel.y * wishY;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, add);
  vel.x += accelSpeed * wishX;
  vel.y += accelSpeed * wishY;
};

/** PM_AirAccelerate: like accelerate, but the add-speed test uses min(wishSpeed, cap). */
export const airAccelerate = (
  vel: Vec2,
  wishX: number,
  wishY: number,
  wishSpeed: number,
  accel: number,
  dt: number,
  cap = MOVE_DEFAULTS.airSpeedCap,
): void => {
  const current = vel.x * wishX + vel.y * wishY;
  const add = Math.min(wishSpeed, cap) - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * wishSpeed * dt, add);
  vel.x += accelSpeed * wishX;
  vel.y += accelSpeed * wishY;
};

/** CS 1.6 stamina ratio: (100 - fuser2 · 0.019) / 100. */
export const staminaFactor = (staminaMs: number): number => (100 - staminaMs * 0.001 * 19) * 0.01;

/**
 * CS applies the stamina ratio once per 10 ms player-move frame. This is the frame-rate independent
 * equivalent for an arbitrary dt.
 */
export const staminaScale = (staminaMs: number, dt: number): number =>
  staminaMs > 0 ? Math.pow(staminaFactor(staminaMs), dt * 100) : 1;

/**
 * Horizontal wish direction from move keys (forward/side in -1..1) and yaw, written to `out`.
 * Returns the input magnitude (0 when no key is held). Diagonals are normalised, as in CS where the
 * wish speed is clamped to maxspeed.
 */
export const wishDirection = (forward: number, side: number, yaw: number, out: Vec2): number => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // forward = (c, s), right = (s, -c)
  const x = forward * c + side * s;
  const y = forward * s - side * c;
  const len = Math.hypot(x, y);
  if (len < 1e-9) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  out.x = x / len;
  out.y = y / len;
  return Math.min(1, len);
};
