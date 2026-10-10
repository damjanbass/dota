import { Vector3 } from 'three';
import type { Vec3 } from './types';

// Coordinate contract:
//   Simulation / map data use WC3 axes: X = east, Y = north, Z = up.
//   Three.js uses Y-up: three.x = wc3.x, three.y = wc3.z, three.z = -wc3.y.
// Convert ONLY at the render boundary. Never store Three.js coordinates in sim state.

export const toThree = (x: number, y: number, z: number, out = new Vector3()): Vector3 =>
  out.set(x, z, -y);

export const vecToThree = (v: Vec3, out = new Vector3()): Vector3 => out.set(v.x, v.z, -v.y);

export const fromThree = (v: Vector3): Vec3 => ({ x: v.x, y: -v.z, z: v.y });

/** WC3 facing (radians, 0 = east, CCW) → Three.js rotation.y. */
export const facingToThreeYaw = (facing: number): number => facing;
