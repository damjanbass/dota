// Sniper's rifle as a CS 1.6 AWP: hitscan, bolt-action cycle (= DotA attack cooldown), movement/scope spread,
// viewpunch. Emits 'player:shot'; damage is applied by the sim, never here.
import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import type { GameEvents, Hittable, ShotResult, Vec3 } from '../core/types';
import { castShot } from './hitbox';
import type { ShotWorld } from './hitbox';
import { DEG, forwardFromAngles, normalize3, rightFromYaw, upFromAngles, vec3 } from './math';

/** CS 1.6 CAWP::PrimaryAttack spread values (tangent of the max deviation). */
export interface SpreadParams {
  /** On ground, (almost) still. */
  still: number;
  /** On ground, moving faster than `stillSpeed`. */
  moving: number;
  /** On ground, faster than `runFraction` × base move speed. */
  running: number;
  /** Airborne. */
  air: number;
  /** Added when not scoped (the no-scope penalty). */
  unscopedPenalty: number;
  stillSpeed: number;
  runFraction: number;
}

export const AWP_SPREAD: Readonly<SpreadParams> = {
  still: 0.001,
  moving: 0.1,
  running: 0.25,
  air: 0.85,
  unscopedPenalty: 0.08,
  stillSpeed: 10,
  // CS: 140 of the AWP's 210 max speed. Shift-walking (0.52×) stays below it.
  runFraction: 140 / 210,
};

export interface SpreadState {
  speed2d: number;
  onGround: boolean;
  scoped: boolean;
  /** Unscoped, unwalked max speed (stats.moveSpeed). */
  baseSpeed: number;
}

export const computeSpread = (s: SpreadState, p: SpreadParams = AWP_SPREAD): number => {
  let spread: number;
  if (!s.onGround) spread = p.air;
  else if (s.speed2d > s.baseSpeed * p.runFraction) spread = p.running;
  else if (s.speed2d > p.stillSpeed) spread = p.moving;
  else spread = p.still;
  return s.scoped ? spread : spread + p.unscopedPenalty;
};

const scratchR = vec3();
const scratchU = vec3();

/** FireBullets3: dir = forward + x·spread·right + y·spread·up with x, y = sum of two uniforms in ±0.5. */
export const applySpread = (yaw: number, pitch: number, spread: number, rng: Rng, out: Vec3): Vec3 => {
  const x = rng.range(-0.5, 0.5) + rng.range(-0.5, 0.5);
  const y = rng.range(-0.5, 0.5) + rng.range(-0.5, 0.5);
  forwardFromAngles(yaw, pitch, out);
  rightFromYaw(yaw, scratchR);
  upFromAngles(yaw, pitch, scratchU);
  out.x += (x * scratchR.x + y * scratchU.x) * spread;
  out.y += (x * scratchR.y + y * scratchU.y) * spread;
  out.z += (x * scratchR.z + y * scratchU.z) * spread;
  return normalize3(out);
};

/** PM_DropPunchAngle in radians: |punch| shrinks by (10° + |punch|/2) per second. */
export const decayPunch = (punch: number, dt: number): number => {
  const len = Math.abs(punch);
  if (len === 0) return 0;
  const next = Math.max(0, len - (10 * DEG + len * 0.5) * dt);
  return Math.sign(punch) * next;
};

export interface RifleParams {
  /** Seconds between shots (DotA attack cooldown → bolt cycle). */
  fireInterval: number;
  /** Max hitscan distance, already multiplied by RANGE_SCALE. */
  range: number;
  spread: SpreadParams;
  /** Viewpunch per shot, radians (CS AWP: punchangle.x -= 2°). Positive = kicks up. */
  punchPitch: number;
}

export interface FireRequest {
  origin: Vec3;
  yaw: number;
  /** View pitch without punch; the current punch is added like CS (v_angle + punchangle). */
  pitch: number;
  speed2d: number;
  onGround: boolean;
  scoped: boolean;
  baseSpeed: number;
  targets: Iterable<Hittable>;
  world: ShotWorld;
  shooterId?: number;
}

export interface FiredShot {
  origin: Vec3;
  direction: Vec3;
  result: ShotResult;
  spread: number;
}

export class Rifle {
  readonly params: RifleParams;
  /** Seconds until the next shot is allowed. */
  cooldown = 0;
  /** Interval used by the last shot (stats can change between shots). */
  lastInterval = 1;
  shots = 0;
  /** Current / previous-tick viewpunch (radians, + = up) for render interpolation. */
  punch = 0;
  prevPunch = 0;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly rng: Rng,
    params: Partial<RifleParams> & Pick<RifleParams, 'fireInterval' | 'range'>,
  ) {
    this.params = { spread: { ...AWP_SPREAD }, punchPitch: 2 * DEG, ...params };
  }

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  /** 0 right after a shot → 1 when the bolt is closed again. */
  get cycle(): number {
    return this.lastInterval > 0 ? 1 - Math.max(0, this.cooldown) / this.lastInterval : 1;
  }

  tick(dt: number): void {
    this.prevPunch = this.punch;
    this.punch = decayPunch(this.punch, dt);
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  }

  fire(req: FireRequest): FiredShot | null {
    if (!this.ready) return null;
    const spread = computeSpread(req, this.params.spread);
    const direction = applySpread(req.yaw, req.pitch + this.punch, spread, this.rng, vec3());
    const origin = vec3(req.origin.x, req.origin.y, req.origin.z);
    const result = castShot(origin, direction, this.params.range, req.targets, req.world, req.shooterId);
    this.lastInterval = this.params.fireInterval;
    this.cooldown = this.params.fireInterval;
    this.punch += this.params.punchPitch;
    this.shots++;
    this.events.emit('player:shot', { origin, direction, result });
    return { origin, direction, result, spread };
  }
}
