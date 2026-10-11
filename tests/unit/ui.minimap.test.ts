import { describe, expect, it } from 'vitest';
import { createMinimapTransform, minimapToWorld, worldToMinimap, yawToCanvasAngle } from '../../src/ui/minimapMath';
import { createMockMap } from '../../src/core/mockMap';

describe('ui minimap transform', () => {
  const bounds = { minX: -7552, minY: -7936, maxX: 7552, maxY: 7424 }; // real 6.83d playable area
  const t = createMinimapTransform(bounds, 256);

  it('is north-up: south-west corner bottom-left, north-east top-right', () => {
    const sw = worldToMinimap(t, bounds.minX, bounds.minY);
    const ne = worldToMinimap(t, bounds.maxX, bounds.maxY);
    expect(sw.y).toBeCloseTo(256, 5);
    expect(ne.y).toBeCloseTo(0, 5);
    expect(sw.x).toBeLessThan(ne.x);
    // Higher Y (north) → smaller pixel y.
    expect(worldToMinimap(t, 0, 1000).y).toBeLessThan(worldToMinimap(t, 0, 0).y);
  });

  it('keeps the aspect ratio and centres the narrow axis', () => {
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    expect(t.scale).toBeCloseTo(256 / Math.max(w, h));
    const sw = worldToMinimap(t, bounds.minX, bounds.minY);
    const ne = worldToMinimap(t, bounds.maxX, bounds.maxY);
    expect(sw.x).toBeCloseTo(256 - ne.x, 5);
    expect(ne.x - sw.x).toBeCloseTo(w * t.scale, 5);
  });

  it('round-trips world and pixels and reuses the out object', () => {
    const out = { x: 0, y: 0 };
    const p = worldToMinimap(t, 1234, -4321, out);
    expect(p).toBe(out);
    const back = minimapToWorld(t, p.x, p.y);
    expect(back.x).toBeCloseTo(1234, 6);
    expect(back.y).toBeCloseTo(-4321, 6);
  });

  it('places Sentinel bottom-left and Scourge top-right on the mock map', () => {
    const map = createMockMap();
    const mt = createMinimapTransform(map.data.bounds, 200);
    const s = map.data.entities.find((e) => e.kind === 'ancient' && e.team === 'sentinel')!;
    const u = map.data.entities.find((e) => e.kind === 'ancient' && e.team === 'scourge')!;
    const ps = worldToMinimap(mt, s.x, s.y);
    const pu = worldToMinimap(mt, u.x, u.y);
    expect(ps.x).toBeLessThan(100);
    expect(ps.y).toBeGreaterThan(100);
    expect(pu.x).toBeGreaterThan(100);
    expect(pu.y).toBeLessThan(100);
  });

  it('flips yaw for canvas angles (north = up)', () => {
    const a = yawToCanvasAngle(Math.PI / 2);
    expect(Math.sin(a)).toBeCloseTo(-1);
  });
});
