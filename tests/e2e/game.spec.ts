import { expect, test } from '@playwright/test';

// Gate 1: walk the real map from the Sentinel fountain into the Scourge base, steering the FPS player
// through its test hooks (sim-time exact) along a grid A* path over window.__game.canStand
// (terrain pathing + trees + building colliders). Proves terrain, collision and the world work together.
test('walk Sentinel fountain → Scourge base', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/?scene=game&test=1&debug=1');
  await page.waitForFunction(() => window.__sceneReady === true && !!window.__player && !!window.__game, undefined, {
    timeout: 60_000,
  });
  await page.screenshot({ path: 'test-results/game-spawn.png' });

  const result = await page.evaluate(async () => {
    const data = (await (await fetch('/data/map.json')).json()) as {
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      entities: Array<{ kind: string; team: string; x: number; y: number }>;
    };
    const ancient = data.entities.find((e) => e.kind === 'ancient' && e.team === 'scourge')!;
    const p = window.__player!;
    const canStand = window.__game!.canStand;

    // --- grid A* (64-unit cells, 8-connected, no corner cutting) ---
    const C = 64;
    const { minX, minY, maxX, maxY } = data.bounds;
    const cols = Math.ceil((maxX - minX) / C);
    const rows = Math.ceil((maxY - minY) / C);
    const free = new Int8Array(cols * rows).fill(-1);
    const isFree = (cx: number, cy: number): boolean => {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
      const i = cy * cols + cx;
      if (free[i] === -1) free[i] = canStand(minX + (cx + 0.5) * C, minY + (cy + 0.5) * C) ? 1 : 0;
      return free[i] === 1;
    };
    const cell = (x: number, y: number): [number, number] => [Math.floor((x - minX) / C), Math.floor((y - minY) / C)];
    const nearestFree = (x: number, y: number): [number, number] => {
      const [cx, cy] = cell(x, y);
      for (let r = 0; r < 20; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (isFree(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      return [cx, cy];
    };
    const start = p.state.position;
    const [sx, sy] = nearestFree(start.x, start.y);
    const [gx, gy] = nearestFree(ancient.x - 700, ancient.y - 700);
    const g = new Float64Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const open: Array<[number, number]> = [[0, sy * cols + sx]];
    g[sy * cols + sx] = 0;
    const h = (i: number): number => Math.hypot((i % cols) - gx, Math.floor(i / cols) - gy);
    const goal = gy * cols + gx;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k]![0] < open[bi]![0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0]!;
      if (cur === goal) break;
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isFree(nx, ny) || (dx && dy && (!isFree(cx + dx, cy) || !isFree(cx, cy + dy)))) continue;
        const ni = ny * cols + nx;
        const ng = g[cur]! + (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[ni]!) {
          g[ni] = ng;
          came[ni] = cur;
          open.push([ng + h(ni), ni]);
        }
      }
    }
    if (came[goal] === -1) return { ok: false, reason: 'no path', end: start };
    const path: Array<{ x: number; y: number }> = [];
    for (let i = goal; i !== -1; i = came[i]!) path.push({ x: minX + ((i % cols) + 0.5) * C, y: minY + (Math.floor(i / cols) + 0.5) * C });
    path.reverse();
    const route = path.filter((_, i) => i % 3 === 0 || i === path.length - 1);

    // --- follow the route ---
    const wait = async (): Promise<void> => {
      while (p.holding) await new Promise((r) => setTimeout(r, 16));
    };
    let stuck = 0;
    for (const wp of route) {
      for (let step = 0; step < 60; step++) {
        const s = p.state;
        const dx = wp.x - s.position.x;
        const dy = wp.y - s.position.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 70) break;
        let dYaw = Math.atan2(dy, dx) - s.yaw;
        dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
        p.look(dYaw, 0);
        p.hold(['forward'], Math.min(0.5, dist / 290));
        await wait();
        const a = p.state.position;
        if (Math.hypot(a.x - s.position.x, a.y - s.position.y) < 10) stuck++;
        if (stuck > 30) return { ok: false, reason: `stuck near ${a.x.toFixed(0)},${a.y.toFixed(0)}`, end: a };
      }
    }
    const end = p.state.position;
    return { ok: Math.hypot(end.x - ancient.x, end.y - ancient.y) < 1300, reason: '', end, pathCells: path.length, stuck };
  });

  await page.screenshot({ path: 'test-results/game-scourge-base.png' });
  console.log('walk result', JSON.stringify(result));
  expect(result.ok).toBe(true);
  expect(errors).toEqual([]);
});
