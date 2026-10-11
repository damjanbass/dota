import { describe, expect, it } from 'vitest';
import { entitiesOfKind, isWalkable } from '../../src/core/map';
import { createMockMap } from '../../src/core/mockMap';
import { createRng } from '../../src/core/rng';
import type { Vec2 } from '../../src/core/types';
import { loadRealMap } from '../../src/ai/testing/loadMap';
import {
  astar,
  buildingFootprint,
  createNavGrid,
  createPathFinder,
  lineOfSight,
  NavGrid,
  pathLength,
  SearchScratch,
  smoothPath,
  stampMapBuildings,
} from '../../src/nav';
import type { NavPathFinder } from '../../src/nav';

const map = loadRealMap();
const grid = createNavGrid(map);
const stamps = stampMapBuildings(grid, map);
const pf = createPathFinder(grid, { lanes: map.data.lanes });
const spawn = entitiesOfKind(map, 'hero_spawn', 'sentinel')[0]!;

/** Every segment after `from` stays on walkable cells (thin supercover line of sight). */
const assertWalkablePath = (g: NavGrid, path: readonly Vec2[], skipFirst = false): void => {
  for (let i = skipFirst ? 1 : 0; i < path.length; i++) expect(g.isWalkable(path[i]!.x, path[i]!.y)).toBe(true);
  for (let i = skipFirst ? 2 : 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    expect(lineOfSight(g, a.x, a.y, b.x, b.y), `segment ${i} (${a.x},${a.y})→(${b.x},${b.y})`).toBe(true);
  }
};

const randomReachable = (p: NavPathFinder, seed: number, count: number): Vec2[] => {
  const rng = createRng(seed);
  const b = map.data.bounds;
  const out: Vec2[] = [];
  while (out.length < count) {
    const q = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
    if (p.reachable(spawn, q)) out.push(q);
  }
  return out;
};

describe('nav grid', () => {
  it('matches the map pathing layer inside the playable bounds', () => {
    const fresh = createNavGrid(map);
    const b = map.data.bounds;
    let checked = 0;
    for (let cy = 0; cy < fresh.rows; cy += 3) {
      for (let cx = 0; cx < fresh.cols; cx += 3) {
        const x = fresh.centerX(cx);
        const y = fresh.centerY(cy);
        const inside = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
        expect(fresh.isWalkableCell(cx, cy)).toBe(inside && isWalkable(map, x, y));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });

  it('reference-counts dynamic blockers', () => {
    const g = createNavGrid(map);
    const p = { x: spawn.x + 300, y: spawn.y };
    expect(g.isWalkable(p.x, p.y)).toBe(true);
    const v0 = g.version;
    g.setBlocked(p.x, p.y, 64, true);
    g.setBlocked(p.x, p.y, 64, true);
    expect(g.isWalkable(p.x, p.y)).toBe(false);
    expect(g.version).toBeGreaterThan(v0);
    g.setBlocked(p.x, p.y, 64, false);
    expect(g.isWalkable(p.x, p.y)).toBe(false);
    g.setBlocked(p.x, p.y, 64, false);
    expect(g.isWalkable(p.x, p.y)).toBe(true);
  });

  it('stamps every tower, barracks, ancient, fountain and shop', () => {
    for (const e of map.data.entities) {
      const r = buildingFootprint(e);
      if (r === null) continue;
      expect(stamps.ids()).toContain(e.id);
      expect(grid.isWalkable(e.x, e.y)).toBe(false);
    }
  });
});

describe('path finding on the real 6.83d map', () => {
  const fountains = entitiesOfKind(map, 'fountain');
  const towers = entitiesOfKind(map, 'tower');

  it('finds paths between both fountains and every tower', () => {
    expect(fountains).toHaveLength(2);
    expect(towers).toHaveLength(22);
    const ff = pf.findPath(fountains[0]!, fountains[1]!, 24);
    expect(ff).not.toBeNull();
    assertWalkablePath(grid, ff!, true);
    for (const f of fountains) {
      for (const t of towers) {
        const path = pf.findPath(f, t, 24);
        expect(path, `fountain ${f.team} → tower ${t.team} ${t.lane} t${t.tier}`).not.toBeNull();
        assertWalkablePath(grid, path!, true);
        const end = path![path!.length - 1]!;
        // The tower centre is blocked, so the path ends right outside its footprint.
        expect(Math.hypot(end.x - t.x, end.y - t.y)).toBeLessThan(buildingFootprint(t)! + 3 * grid.cellSize);
      }
    }
  });

  it('never crosses unwalkable cells and smoothing keeps line of sight', () => {
    const pts = randomReachable(pf, 7, 120);
    for (let i = 0; i < pts.length; i += 2) {
      const path = pf.findPath(pts[i]!, pts[i + 1]!, 24);
      expect(path).not.toBeNull();
      expect(path![0]).toEqual(pts[i]);
      expect(path![path!.length - 1]).toEqual(pts[i + 1]);
      assertWalkablePath(grid, path!);
    }
  });

  it('smoothing shortens the raw A* cell path', () => {
    const scratch = new SearchScratch(grid.cols * grid.rows);
    const pts = randomReachable(pf, 11, 20);
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const res = astar(grid, scratch, grid.cellAt(a.x, a.y), grid.cellAt(b.x, b.y), { x0: 0, y0: 0, x1: grid.cols - 1, y1: grid.rows - 1 }, 1e6);
      expect(res.status).toBe('found');
      const raw = res.cells.map((c) => ({ x: grid.centerX(c % grid.cols), y: grid.centerY((c / grid.cols) | 0) }));
      const smooth = smoothPath(grid, res.cells, a, b, 0);
      assertWalkablePath(grid, smooth);
      expect(smooth.length).toBeLessThan(raw.length / 4);
      expect(pathLength(smooth)).toBeLessThanOrEqual(pathLength([a, ...raw, b]) + 1e-6);
      // HPA* + smoothing stays close to the optimal (A*) length.
      const hier = pf.findPath(a, b, 0)!;
      expect(pathLength(hier)).toBeLessThan(pathLength(smooth) * 1.12 + 64);
    }
  });

  it('snaps a start or goal inside a blocked cell to the nearest walkable cell', () => {
    const tower = towers[0]!;
    const fromTower = pf.findPath(tower, spawn, 24)!;
    expect(fromTower).not.toBeNull();
    expect(fromTower[0]).toEqual({ x: tower.x, y: tower.y });
    expect(grid.isWalkable(fromTower[1]!.x, fromTower[1]!.y)).toBe(true);
    const tree = map.data.trees.find(([x, y]) => !grid.isWalkable(x, y) && grid.isWalkable(x + 160, y))!;
    const toTree = pf.findPath(spawn, { x: tree[0], y: tree[1] }, 24)!;
    expect(toTree).not.toBeNull();
    const end = toTree[toTree.length - 1]!;
    expect(grid.isWalkable(end.x, end.y)).toBe(true);
    expect(Math.hypot(end.x - tree[0], end.y - tree[1])).toBeLessThan(6 * grid.cellSize);
  });

  it('builds lane paths for both teams', () => {
    for (const lane of ['top', 'mid', 'bot'] as const) {
      const wp = map.data.lanes[lane];
      for (const team of ['sentinel', 'scourge'] as const) {
        const path = pf.lanePath(lane, team);
        const first = team === 'sentinel' ? wp[0]! : wp[wp.length - 1]!;
        const last = team === 'sentinel' ? wp[wp.length - 1]! : wp[0]!;
        expect(Math.hypot(path[0]!.x - first.x, path[0]!.y - first.y)).toBeLessThan(200);
        expect(Math.hypot(path[path.length - 1]!.x - last.x, path[path.length - 1]!.y - last.y)).toBeLessThan(200);
        expect(pf.lanePath(lane, team)).toBe(path); // cached
      }
    }
  });

  it('answers 200 random full-map requests in under 50 ms', () => {
    const fresh = createNavGrid(map);
    stampMapBuildings(fresh, map);
    const p = createPathFinder(fresh);
    const pts = randomReachable(p, 2024, 400 * 4);
    // Warm up the JIT, then take the best of three runs (each on new pairs, so no cache hits).
    for (let i = 0; i < 400; i += 2) p.findPath(pts[i]!, pts[i + 1]!, 24);
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const base = 400 + run * 400;
      const t0 = performance.now();
      for (let i = 0; i < 400; i += 2) expect(p.findPath(pts[base + i]!, pts[base + i + 1]!, 24)).not.toBeNull();
      runs.push(performance.now() - t0);
    }
    expect(p.stats.cacheHits).toBeLessThan(20);
    expect(Math.min(...runs)).toBeLessThan(50);
  });
});

describe('path finding with dynamic blockers', () => {
  // 64×32 open grid with a wall at x = 32 that has a single 2-cell gap at y = 10..11.
  const makeGrid = (): NavGrid => {
    const cols = 64;
    const rows = 32;
    const blocked = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) if (y !== 10 && y !== 11) blocked[y * cols + 32] = 1;
    return new NavGrid(cols, rows, 0, 0, 32, blocked);
  };

  it('routes through the gap, around a stamped blocker, and back when it is removed', () => {
    const g = makeGrid();
    const p = createPathFinder(g);
    const a = { x: 10 * 32 + 16, y: 25 * 32 + 16 };
    const b = { x: 54 * 32 + 16, y: 25 * 32 + 16 };
    const open = p.findPath(a, b, 16)!;
    expect(open).not.toBeNull();
    assertWalkablePath(g, open);
    expect(open.some((q) => q.y < 13 * 32 && q.y > 9 * 32)).toBe(true);
    // Plug the gap: the goal is now on another island, so the path ends at the closest reachable cell.
    g.setBlocked(32 * 32 + 16, 11 * 32, 40, true);
    expect(p.reachable(a, b)).toBe(false);
    const plugged = p.findPath(a, b, 16)!;
    assertWalkablePath(g, plugged);
    expect(plugged[plugged.length - 1]!.x).toBeLessThan(32 * 32);
    // Far away from any reachable cell → no path at all.
    expect(p.findPath(a, { x: 63 * 32, y: 25 * 32 }, 16)).toBeNull();
    g.setBlocked(32 * 32 + 16, 11 * 32, 40, false);
    const again = p.findPath(a, b, 16)!;
    expect(again).not.toBeNull();
    assertWalkablePath(g, again);
  });

  it('rebuilds the hierarchy after a blocker lands on a long corridor', () => {
    const g = createNavGrid(map);
    const p = createPathFinder(g);
    const midT1 = towers()[0]!;
    const before = p.findPath(spawn, midT1, 24)!;
    g.setBlocked(midT1.x, midT1.y, 300, true);
    const after = p.findPath(spawn, midT1, 24)!;
    expect(after).not.toBeNull();
    assertWalkablePath(g, after);
    const end = after[after.length - 1]!;
    expect(Math.hypot(end.x - midT1.x, end.y - midT1.y)).toBeGreaterThan(280);
    expect(before).not.toEqual(after);
  });

  function towers() {
    return entitiesOfKind(map, 'tower', 'sentinel').filter((t) => t.lane === 'mid' && t.tier === 1);
  }
});

describe('path finding on the mock map', () => {
  it('connects the fountains', () => {
    const mock = createMockMap();
    const g = createNavGrid(mock);
    stampMapBuildings(g, mock);
    const p = createPathFinder(g, { lanes: mock.data.lanes });
    const [f1, f2] = entitiesOfKind(mock, 'fountain');
    const path = p.findPath(f1!, f2!, 24);
    expect(path).not.toBeNull();
    assertWalkablePath(g, path!, true);
    expect(p.lanePath('mid', 'scourge').length).toBeGreaterThan(1);
  });
});
