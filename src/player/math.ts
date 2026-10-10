// Small allocation-free vector / angle helpers shared by the player module (WC3 axes: X east, Y north, Z up).
import type { Vec2, Vec3 } from '../core/types';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const set3 = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const copy3 = (out: Vec3, v: Vec3): Vec3 => set3(out, v.x, v.y, v.z);

export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const length2 = (v: Vec2): number => Math.hypot(v.x, v.y);

export const normalize3 = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len > 1e-12) {
    v.x /= len;
    v.y /= len;
    v.z /= len;
  }
  return v;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wraps an angle to (-PI, PI]. */
export const wrapAngle = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);

/** Shortest-path angle interpolation. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

/**
 * View direction for (yaw, pitch). Yaw follows the WC3 facing convention (0 = east, CCW),
 * pitch is positive when looking up.
 */
export const forwardFromAngles = (yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 => {
  const cp = Math.cos(pitch);
  return set3(out, Math.cos(yaw) * cp, Math.sin(yaw) * cp, Math.sin(pitch));
};

/** Horizontal right vector for a yaw (forward rotated 90° clockwise). */
export const rightFromYaw = (yaw: number, out: Vec3 = vec3()): Vec3 => set3(out, Math.sin(yaw), -Math.cos(yaw), 0);

/** Camera up vector for (yaw, pitch) = right × forward. */
export const upFromAngles = (yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 => {
  const sp = Math.sin(pitch);
  return set3(out, -Math.cos(yaw) * sp, -Math.sin(yaw) * sp, Math.cos(pitch));
};
