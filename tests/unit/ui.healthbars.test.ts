import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera } from 'three';
import { distanceFade, isDeniable, projectToScreen, selectNearest } from '../../src/ui/projection';
import { toThree } from '../../src/core/coords';

const viewProj = (camera: PerspectiveCamera): number[] => {
  camera.updateMatrixWorld();
  return new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray();
};

describe('ui overhead bar projection', () => {
  // Camera at WC3 (0,0,64) looking east (+X).
  const cam = new PerspectiveCamera(60, 16 / 9, 4, 20000);
  toThree(0, 0, 64, cam.position);
  cam.lookAt(toThree(1000, 0, 64));
  const m = viewProj(cam);
  const out = { x: 0, y: 0, depth: 0 };
  const W = 1280;
  const H = 720;

  it('projects a point straight ahead to the screen centre with its depth', () => {
    const p = toThree(500, 0, 64);
    expect(projectToScreen(m, p.x, p.y, p.z, W, H, out)).toBe(true);
    expect(out.x).toBeCloseTo(W / 2, 3);
    expect(out.y).toBeCloseTo(H / 2, 3);
    expect(out.depth).toBeCloseTo(500, 3);
  });

  it('puts higher points (head height) above, and north to the left when facing east', () => {
    const head = toThree(500, 0, 164);
    projectToScreen(m, head.x, head.y, head.z, W, H, out);
    expect(out.y).toBeLessThan(H / 2);
    const north = toThree(500, 100, 64);
    projectToScreen(m, north.x, north.y, north.z, W, H, out);
    expect(out.x).toBeLessThan(W / 2);
  });

  it('culls units behind the camera', () => {
    const p = toThree(-500, 0, 64);
    expect(projectToScreen(m, p.x, p.y, p.z, W, H, out)).toBe(false);
    const nearPlane = toThree(0.5, 0, 64);
    expect(projectToScreen(m, nearPlane.x, nearPlane.y, nearPlane.z, W, H, out)).toBe(false);
  });

  it('culls units off-screen beyond the margin but keeps ones just past the edge', () => {
    const far = toThree(500, 2000, 64);
    expect(projectToScreen(m, far.x, far.y, far.z, W, H, out)).toBe(false);
    // Horizontal half-FOV is ~45.8° at 16:9 with vfov 60: 46.5° is just outside, but inside a 10% margin.
    const edge = toThree(500, 500 * Math.tan((46.5 * Math.PI) / 180), 64);
    expect(projectToScreen(m, edge.x, edge.y, edge.z, W, H, out, 0)).toBe(false);
    expect(projectToScreen(m, edge.x, edge.y, edge.z, W, H, out, 0.1)).toBe(true);
  });

  it('caps bars at the nearest N without reallocating', () => {
    const depth = Array.from({ length: 300 }, (_, i) => 300 - i);
    const order: number[] = [];
    expect(selectNearest(depth, 150, 200, order)).toBe(150);
    expect(order).toHaveLength(150);
    const kept = selectNearest(depth, 300, 200, order);
    expect(kept).toBe(200);
    expect(order).toHaveLength(200);
    const keptDepths = order.map((i) => depth[i]!);
    expect(Math.max(...keptDepths)).toBe(200);
    expect(Math.min(...keptDepths)).toBe(1);
  });

  it('fades with apparent distance', () => {
    expect(distanceFade(500)).toBe(1);
    expect(distanceFade(2400)).toBeCloseTo(0.5);
    expect(distanceFade(5000)).toBe(0);
  });

  it('flags ally creeps under half HP as deniable', () => {
    expect(isDeniable(274, 550)).toBe(true);
    expect(isDeniable(275, 550)).toBe(false);
    expect(isDeniable(0, 0)).toBe(false);
  });
});
