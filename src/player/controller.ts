// CS 1.6-style player controller on the WC3 map: fixed-tick GoldSrc movement, a box hull against the pathing grid
// (axis-separated, so you slide along blocked cells), circle push-out against dynamic obstacles, heightfield ground.
import { PLAYER_RADIUS, EYE_HEIGHT } from '../core/config';
import { groundHeightAt, PathFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import type { Vec2, Vec3 } from '../core/types';
import { DEG, clamp, copy3, lerp, lerpAngle, vec3, wrapAngle } from './math';
import {
  DEFAULT_MAX_SPEED,
  MOVE_DEFAULTS,
  accelerate,
  airAccelerate,
  applyFriction,
  staminaFactor,
  staminaScale,
  wishDirection,
} from './movement';
import type { MoveParams } from './movement';

/** Vertical cylinder that blocks the player (buildings, units). Supplied by the sim later. */
export interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

export interface ObstacleProvider {
  /**
   * Obstacles that may overlap a circle of `radius` at (x, y). May return a reused array; the controller
   * only reads it synchronously.
   */
  obstaclesNear(x: number, y: number, radius: number): Iterable<Obstacle>;
}

/** One tick of player intent (a CS usercmd). */
export interface MoveCommand {
  /** -1..1 (W = +1, S = -1). */
  forward: number;
  /** -1..1 (D = +1, A = -1). */
  side: number;
  /** Jump key held. A jump needs a fresh press (no auto-bhop), like CS. */
  jump: boolean;
  /** Jump pressed during this tick (catches taps / mouse-wheel binds shorter than a tick). */
  jumpPressed: boolean;
  walk: boolean;
}

export interface ControllerOptions {
  x: number;
  y: number;
  /** Initial yaw (WC3 facing, 0 = east, CCW). */
  yaw?: number;
  obstacles?: ObstacleProvider;
  params?: Partial<MoveParams>;
  /** Physics substeps per sim tick (GoldSrc ran at ~100 Hz; 4 × 30 Hz = 120 Hz). */
  substeps?: number;
}

export const MAX_PITCH = 89 * DEG;
const BLOCKING = PathFlag.Unwalkable | PathFlag.Tree;
const EPS = 1e-3;

export class PlayerController {
  /** Feet position (WC3). */
  readonly position: Vec3;
  /** Feet position at the start of the last tick (render interpolation). */
  readonly prevPosition: Vec3;
  readonly velocity: Vec3 = vec3();
  /** View angles. Client input state: written by mouse look at frame rate, read by the tick. */
  yaw: number;
  pitch = 0;
  onGround = true;
  /** Base max speed (stats.moveSpeed), set by the owner each tick. */
  maxSpeed = DEFAULT_MAX_SPEED;
  /** Extra multiplier on max speed (scope). */
  speedMultiplier = 1;
  /** Ground height under the player at the end of the last tick. */
  groundZ: number;
  ticks = 0;
  readonly params: MoveParams;
  obstacles: ObstacleProvider | undefined;

  private readonly substeps: number;
  private tickStartYaw: number;
  private stamina = 0;
  private jumpWasDown = false;
  private jumpQueued = false;
  private readonly wish: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly map: LoadedMap,
    opts: ControllerOptions,
  ) {
    this.params = { ...MOVE_DEFAULTS, ...opts.params };
    this.substeps = Math.max(1, Math.round(opts.substeps ?? 4));
    this.obstacles = opts.obstacles;
    this.yaw = opts.yaw ?? 0;
    this.tickStartYaw = this.yaw;
    const z = groundHeightAt(map, opts.x, opts.y);
    this.position = vec3(opts.x, opts.y, z);
    this.prevPosition = vec3(opts.x, opts.y, z);
    this.groundZ = z;
    this.resolveObstacles();
  }

  /** Mouse look (radians). Positive yaw turns left (CCW), positive pitch looks up. */
  addLook(dYaw: number, dPitch: number): void {
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  setAngles(yaw: number, pitch: number): void {
    this.yaw = wrapAngle(yaw);
    this.tickStartYaw = this.yaw;
    this.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  teleport(x: number, y: number): void {
    const z = groundHeightAt(this.map, x, y);
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    copy3(this.prevPosition, this.position);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.onGround = true;
    this.groundZ = z;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y);
  }

  /** Current wish speed cap (max speed × scope × walk handled per command). */
  effectiveMaxSpeed(walk: boolean): number {
    return this.maxSpeed * this.speedMultiplier * (walk ? this.params.walkMultiplier : 1);
  }

  /** Eye position at the end of the last tick. */
  eye(out: Vec3 = vec3()): Vec3 {
    out.x = this.position.x;
    out.y = this.position.y;
    out.z = this.position.z + EYE_HEIGHT;
    return out;
  }

  /** Feet position interpolated between the last two ticks. */
  interpolatedFeet(alpha: number, out: Vec3): Vec3 {
    out.x = lerp(this.prevPosition.x, this.position.x, alpha);
    out.y = lerp(this.prevPosition.y, this.position.y, alpha);
    out.z = lerp(this.prevPosition.z, this.position.z, alpha);
    return out;
  }

  /** One fixed sim tick. */
  update(cmd: MoveCommand, dt: number): void {
    copy3(this.prevPosition, this.position);
    if ((cmd.jump && !this.jumpWasDown) || cmd.jumpPressed) this.jumpQueued = true;
    this.jumpWasDown = cmd.jump;

    const n = this.substeps;
    const h = dt / n;
    for (let i = 1; i <= n; i++) {
      // Spread the mouse turn of this tick over the substeps so air-strafing behaves like a high-rate client.
      this.substep(cmd, lerpAngle(this.tickStartYaw, this.yaw, i / n), h);
    }
    this.jumpQueued = false;
    this.tickStartYaw = this.yaw;
    this.groundZ = groundHeightAt(this.map, this.position.x, this.position.y);
    this.ticks++;
  }

  private substep(cmd: MoveCommand, yaw: number, dt: number): void {
    const p = this.params;
    const v = this.velocity;
    if (this.stamina > 0) this.stamina = Math.max(0, this.stamina - dt * 1000);

    const amount = wishDirection(cmd.forward, cmd.side, yaw, this.wish);
    const wishSpeed = amount * this.effectiveMaxSpeed(cmd.walk);

    if (this.onGround && this.jumpQueued) {
      // PM_Jump: no friction on the jump frame; stamina left from the previous jump shortens this one.
      this.jumpQueued = false;
      this.onGround = false;
      v.z = p.jumpVelocity * (this.stamina > 0 ? staminaFactor(this.stamina) : 1);
      if (p.jumpStaminaMs > 0) this.stamina = p.jumpStaminaMs;
    }

    if (this.onGround) {
      v.z = 0;
      applyFriction(v, dt, p.friction, p.stopSpeed);
      if (this.stamina > 0) {
        const s = staminaScale(this.stamina, dt);
        v.x *= s;
        v.y *= s;
      }
      accelerate(v, this.wish.x, this.wish.y, wishSpeed, p.accelerate, dt);
    } else {
      airAccelerate(v, this.wish.x, this.wish.y, wishSpeed, p.airAccelerate, dt, p.airSpeedCap);
      v.z -= p.gravity * dt * 0.5;
    }

    this.moveHorizontal(v.x * dt, v.y * dt);

    const pos = this.position;
    const ground = groundHeightAt(this.map, pos.x, pos.y);
    if (this.onGround) {
      if (ground >= pos.z - p.stepDown) {
        pos.z = ground; // follow slopes up and down; the camera smooths step-ups
      } else {
        this.onGround = false; // walked off a ledge
        v.z = 0;
      }
    } else {
      pos.z += v.z * dt;
      v.z -= p.gravity * dt * 0.5;
      if (pos.z <= ground) {
        pos.z = ground;
        if (v.z <= 0) {
          v.z = 0;
          this.onGround = true;
        }
      }
    }
  }

  // --- collision ------------------------------------------------------------

  /** True if the player's square hull (half-size PLAYER_RADIUS, like a GoldSrc hull) overlaps a blocked cell. */
  hullBlocked(x: number, y: number): boolean {
    const g = this.map.data.pathing;
    const r = PLAYER_RADIUS;
    const c0 = Math.floor((x - r - g.originX) / g.cellSize);
    const c1 = Math.floor((x + r - EPS - g.originX) / g.cellSize);
    const r0 = Math.floor((y - r - g.originY) / g.cellSize);
    const r1 = Math.floor((y + r - EPS - g.originY) / g.cellSize);
    if (c0 < 0 || r0 < 0 || c1 >= g.cols || r1 >= g.rows) return true;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) if (this.map.pathing[cy * g.cols + cx]! & BLOCKING) return true;
    }
    return false;
  }

  private moveHorizontal(dx: number, dy: number): void {
    // Big displacements (knockback, teleports) are split so a step never skips a whole cell.
    const cell = this.map.data.pathing.cellSize;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (cell * 0.5)));
    // If we're already stuck inside a blocked cell (spawned in a wall), let the player walk out freely.
    const stuck = this.hullBlocked(this.position.x, this.position.y);
    for (let i = 0; i < steps; i++) {
      this.moveAxis(dx / steps, true, stuck);
      this.moveAxis(dy / steps, false, stuck);
    }
    this.resolveObstacles();
  }

  private moveAxis(delta: number, isX: boolean, stuck: boolean): void {
    if (delta === 0) return;
    const pos = this.position;
    const nx = isX ? pos.x + delta : pos.x;
    const ny = isX ? pos.y : pos.y + delta;
    if (stuck || !this.hullBlocked(nx, ny)) {
      pos.x = nx;
      pos.y = ny;
      return;
    }
    // Slide flush against the blocked cell boundary, then kill velocity into the wall (PM_ClipVelocity on an axis plane).
    const g = this.map.data.pathing;
    const r = PLAYER_RADIUS;
    const origin = isX ? g.originX : g.originY;
    const cur = isX ? pos.x : pos.y;
    const edge =
      delta > 0
        ? origin + (Math.floor((cur + r - EPS - origin) / g.cellSize) + 1) * g.cellSize - r - EPS
        : origin + Math.floor((cur - r - origin) / g.cellSize) * g.cellSize + r + EPS;
    const target = delta > 0 ? Math.min(cur + delta, edge) : Math.max(cur + delta, edge);
    if ((delta > 0 ? target > cur : target < cur) && !this.hullBlocked(isX ? target : pos.x, isX ? pos.y : target)) {
      if (isX) pos.x = target;
      else pos.y = target;
    }
    if (isX) this.velocity.x = 0;
    else this.velocity.y = 0;
  }

  private resolveObstacles(): void {
    if (!this.obstacles) return;
    const pos = this.position;
    const v = this.velocity;
    for (const o of this.obstacles.obstaclesNear(pos.x, pos.y, PLAYER_RADIUS)) {
      const min = PLAYER_RADIUS + o.radius;
      let dx = pos.x - o.x;
      let dy = pos.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      const px = o.x + nx * (min + EPS);
      const py = o.y + ny * (min + EPS);
      if (!this.hullBlocked(px, py) || this.hullBlocked(pos.x, pos.y)) {
        pos.x = px;
        pos.y = py;
      }
      const into = v.x * nx + v.y * ny;
      if (into < 0) {
        v.x -= nx * into;
        v.y -= ny * into;
      }
    }
  }
}
