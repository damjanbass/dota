import { describe, expect, it } from 'vitest';
import { groundHeightAt } from '../../src/core/map';
import { createMockMap } from '../../src/core/mockMap';
import { createRng } from '../../src/core/rng';
import type { Hittable, Vec3 } from '../../src/core/types';
import {
  HEAD_PRIORITY_EPSILON,
  TREE_TRUNK_RADIUS,
  TreeGrid,
  castShot,
  headCenterZ,
  hitboxFor,
  raySphere,
  rayVerticalCapsule,
  rayVerticalCylinder,
  resolveHitPart,
  traceTerrain,
} from '../../src/player/hitbox';
import { normalize3 } from '../../src/player/math';
import { createTestMap } from '../../src/player/testing';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dirTo = (a: Vec3, b: Vec3): Vec3 => normalize3(v(b.x - a.x, b.y - a.y, b.z - a.z));

const unit = (id: number, x: number, y: number, z = 0, over: Partial<Hittable> = {}): Hittable => ({
  id,
  team: 'scourge',
  position: { x, y, z },
  ...hitboxFor({ collisionRadius: 24, height: 96 }),
  alive: true,
  ...over,
});

describe('primitive rays', () => {
  it('ray vs sphere: hit distance, miss, inside', () => {
    const o = v(0, 0, 0);
    expect(raySphere(o, v(1, 0, 0), 100, 0, 0, 10)).toBeCloseTo(90, 9);
    expect(raySphere(o, v(1, 0, 0), 100, 11, 0, 10)).toBe(Infinity);
    expect(raySphere(o, v(-1, 0, 0), 100, 0, 0, 10)).toBe(Infinity); // behind
    expect(raySphere(v(100, 0, 0), v(1, 0, 0), 100, 0, 0, 10)).toBe(0);
  });

  it('ray vs upright capsule: side, end caps and misses', () => {
    const o = v(0, 0, 50);
    // side of a capsule from z 20..80, radius 10, 100 units east
    expect(rayVerticalCapsule(o, v(1, 0, 0), 100, 0, 20, 80, 10)).toBeCloseTo(90, 9);
    // just above the segment end: hits the rounded top cap, not the flat cylinder top
    const high = v(0, 0, 85);
    const tCap = rayVerticalCapsule(high, v(1, 0, 0), 100, 0, 20, 80, 10);
    expect(tCap).toBeCloseTo(100 - Math.sqrt(100 - 25), 6);
    expect(rayVerticalCapsule(v(0, 0, 91), v(1, 0, 0), 100, 0, 20, 80, 10)).toBe(Infinity);
    expect(rayVerticalCapsule(o, v(1, 0, 0), 100, 12, 20, 80, 10)).toBe(Infinity);
    // straight down onto the top
    expect(rayVerticalCapsule(v(100, 0, 200), v(0, 0, -1), 100, 0, 20, 80, 10)).toBeCloseTo(110, 9);
  });

  it('ray vs solid cylinder (trunk): side, top, ignores a shooter standing inside', () => {
    expect(rayVerticalCylinder(v(0, 0, 50), v(1, 0, 0), 100, 0, 0, 250, 24)).toBeCloseTo(76, 9);
    expect(rayVerticalCylinder(v(0, 0, 300), v(1, 0, 0), 100, 0, 0, 250, 24)).toBe(Infinity);
    expect(rayVerticalCylinder(v(100, 0, 400), v(0, 0, -1), 100, 0, 0, 250, 24)).toBeCloseTo(150, 9);
    expect(rayVerticalCylinder(v(100, 0, 50), v(1, 0, 0), 100, 0, 0, 250, 24)).toBe(Infinity);
  });
});

describe('hitboxFor', () => {
  it('stacks a head sphere on a body capsule that together span the unit height', () => {
    const h = hitboxFor({ collisionRadius: 24, height: 96 });
    expect(h.bodyRadius).toBeGreaterThan(0);
    expect(h.headRadius).toBeGreaterThan(0);
    expect(h.headRadius).toBeLessThan(h.bodyRadius);
    expect(h.bodyHeight + 2 * h.headRadius).toBeCloseTo(96, 9);
  });

  it('scales with the unit', () => {
    const small = hitboxFor({ collisionRadius: 8, height: 50 });
    const big = hitboxFor({ collisionRadius: 64, height: 300 });
    expect(big.bodyRadius).toBeGreaterThan(small.bodyRadius);
    expect(big.headRadius).toBeGreaterThan(small.headRadius);
  });
});

describe('castShot vs units', () => {
  const eye = v(0, 0, 64);

  it('reports a head hit when aimed at the head centre', () => {
    const t = unit(7, 500, 0);
    const r = castShot(eye, dirTo(eye, v(500, 0, headCenterZ(t))), 3000, [t]);
    expect(r).toMatchObject({ targetId: 7, part: 'head', blockedBy: null });
    expect(r.distance).toBeGreaterThan(480);
    expect(r.distance).toBeLessThan(500);
    expect(Math.hypot(r.point.x - 500, r.point.z - headCenterZ(t))).toBeCloseTo(t.headRadius, 1);
  });

  it('reports a body hit at chest height and a miss just above the head', () => {
    const t = unit(7, 500, 0);
    expect(castShot(eye, dirTo(eye, v(500, 0, 50)), 3000, [t]).part).toBe('body');
    const over = castShot(eye, dirTo(eye, v(500, 0, headCenterZ(t) + t.headRadius + 1)), 3000, [t]);
    expect(over).toMatchObject({ targetId: null, part: null, blockedBy: 'range' });
    expect(over.distance).toBe(3000);
  });

  it('misses to the side, ignores dead units and the shooter, respects max range', () => {
    const t = unit(7, 500, 0);
    expect(castShot(eye, dirTo(eye, v(500, 40, 50)), 3000, [t]).targetId).toBeNull();
    expect(castShot(eye, dirTo(eye, v(500, 0, 50)), 3000, [{ ...t, alive: false }]).targetId).toBeNull();
    expect(castShot(eye, dirTo(eye, v(500, 0, 50)), 3000, [t], {}, 7).targetId).toBeNull();
    const short = castShot(eye, dirTo(eye, v(500, 0, 50)), 400, [t]);
    expect(short).toMatchObject({ targetId: null, blockedBy: 'range', distance: 400 });
  });

  it('hits the nearest of several units on the line', () => {
    const near = unit(1, 300, 0);
    const far = unit(2, 600, 0);
    expect(castShot(eye, v(1, 0, 0), 3000, [far, near]).targetId).toBe(1);
  });

  it('head wins when head and body are hit at the same distance', () => {
    expect(resolveHitPart(100, 100)).toEqual({ part: 'head', t: 100 });
    expect(resolveHitPart(100 + HEAD_PRIORITY_EPSILON * 0.5, 100).part).toBe('head');
    expect(resolveHitPart(150, 100).part).toBe('body');
    expect(resolveHitPart(Infinity, 100).part).toBe('body');
    expect(resolveHitPart(Infinity, Infinity).part).toBeNull();

    // Two units on the same spot: A's body and B's head are entered at exactly the same distance.
    const a = unit(1, 500, 0, 0, { bodyRadius: 12, bodyHeight: 120, headRadius: 8 });
    const b = unit(2, 500, 0, 0, { bodyRadius: 12, bodyHeight: 64 - 12, headRadius: 12 }); // head centre at z 64
    for (const order of [[a, b], [b, a]]) {
      const r = castShot(eye, v(1, 0, 0), 3000, order);
      expect(r.distance).toBeCloseTo(488, 6);
      expect(r).toMatchObject({ targetId: 2, part: 'head' });
    }
  });
});

describe('castShot vs world', () => {
  it('terrain raymarch blocks a shot at a unit behind a hill (absolute heights)', () => {
    const base = 1024;
    const hill = (x: number, y: number): number => base + 220 * Math.exp(-((x - 400) ** 2 + y ** 2) / (2 * 150 ** 2));
    const map = createTestMap({ height: hill });
    const eye = v(0, 0, groundHeightAt(map, 0, 0) + 64);
    const target = unit(9, 800, 0, groundHeightAt(map, 800, 0));
    const aim = dirTo(eye, v(800, 0, headCenterZ(target)));
    const r = castShot(eye, aim, 3000, [target], { map });
    expect(r.blockedBy).toBe('terrain');
    expect(r.targetId).toBeNull();
    expect(r.point.x).toBeGreaterThan(150);
    expect(r.point.x).toBeLessThan(400);
    expect(r.point.z).toBeCloseTo(groundHeightAt(map, r.point.x, r.point.y), 0);

    // Without the hill the same shot connects.
    const flat = createTestMap({ height: () => base });
    const t2 = unit(9, 800, 0, base);
    expect(castShot(eye, aim, 3000, [t2], { map: flat }).targetId).toBe(9);
  });

  it('traceTerrain finds the ground when shooting down and misses when shooting up', () => {
    const map = createTestMap({ height: () => 900 });
    expect(traceTerrain(map, v(0, 0, 1000), normalize3(v(1, 0, -1)), 5000)).toBeCloseTo(100 * Math.SQRT2, 1);
    expect(traceTerrain(map, v(0, 0, 1000), normalize3(v(1, 0, 0.2)), 5000)).toBe(Infinity);
  });

  it('a tree trunk between shooter and unit blocks the shot', () => {
    const trees: Array<[number, number, number, number, number, number]> = [[300, 0, 0, 1, 0, 0]];
    const map = createTestMap({ trees });
    const grid = new TreeGrid(map.data.trees);
    const eye = v(0, 0, 64);
    const t = unit(3, 600, 0);
    const r = castShot(eye, v(1, 0, 0), 3000, [t], { map, trees: grid });
    expect(r).toMatchObject({ targetId: null, blockedBy: 'tree' });
    expect(r.distance).toBeCloseTo(300 - TREE_TRUNK_RADIUS, 6);
    // A shot that clears the trunk (beside it) reaches the unit.
    const t2 = unit(4, 600, 80);
    expect(castShot(eye, dirTo(eye, v(600, 80, 50)), 3000, [t2], { map, trees: grid }).targetId).toBe(4);
  });

  it('building cylinders block shots', () => {
    const eye = v(0, 0, 64);
    const r = castShot(eye, v(1, 0, 0), 3000, [unit(1, 800, 0)], { buildings: [{ x: 400, y: 0, z: 0, radius: 80, height: 300 }] });
    expect(r).toMatchObject({ targetId: null, blockedBy: 'building' });
    expect(r.distance).toBeCloseTo(320, 6);
  });

  it('TreeGrid DDA agrees with brute force on the mock map trees', () => {
    const map = createMockMap();
    const grid = new TreeGrid(map.data.trees);
    const rng = createRng(42);
    const out = { t: 0, index: -1 };
    let hits = 0;
    for (let k = 0; k < 300; k++) {
      const x = rng.range(-5000, 5000);
      const y = rng.range(-5000, 5000);
      const o = v(x, y, groundHeightAt(map, x, y) + 64);
      const a = rng.range(0, Math.PI * 2);
      const d = normalize3(v(Math.cos(a), Math.sin(a), rng.range(-0.15, 0.1)));
      let best = Infinity;
      for (const [tx, ty, tz, s] of map.data.trees) {
        best = Math.min(best, rayVerticalCylinder(o, d, tx, ty, tz, tz + 250 * s, TREE_TRUNK_RADIUS * s));
      }
      if (best > 3000) best = Infinity;
      grid.raycast(o, d, 3000, out);
      expect(out.t).toBeCloseTo(best, 2); // grid stores Float32
      if (best < Infinity) hits++;
    }
    expect(hits).toBeGreaterThan(30);
  });
});
