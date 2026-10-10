import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Drives the ?scene=fps firing range headless through window.__player (test mode, no pointer lock).
// Runs on the real extracted map (default) and on the procedural mock (?map=mock).

const boot = async (page: Page, map: 'real' | 'mock'): Promise<string[]> => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?scene=fps&test=1${map === 'mock' ? '&map=mock' : ''}`);
  await page.waitForFunction(() => window.__sceneReady === true && window.__player !== undefined, undefined, { timeout: 45_000 });
  await page.waitForTimeout(300);
  return errors;
};

for (const map of ['real', 'mock'] as const) {
  test.describe(`fps player (${map} map)`, () => {
    test('W moves at CS 1.6 speed; a scoped shot at the first dummy head is a headshot', async ({ page }) => {
      const errors = await boot(page, map);
      await page.screenshot({ path: `test-results/player-${map}-unscoped.png` });

      // --- movement: hold W for 1 s ------------------------------------------------------------
      // hold() counts sim ticks, so the result doesn't depend on how fast swiftshader renders frames.
      const s0 = await page.evaluate(() => {
        window.__player!.hold(['forward'], 1);
        return window.__player!.state;
      });
      expect(s0.onGround).toBe(true);
      expect(s0.position.z).toBeCloseTo(s0.groundZ, 3); // absolute heights: feet on the ground, whatever its Z
      await page.waitForFunction(() => window.__player!.holdResult !== null, undefined, { timeout: 20_000 });
      const s1 = await page.evaluate(() => window.__player!.holdResult!);
      const moved = Math.hypot(s1.position.x - s0.position.x, s1.position.y - s0.position.y);
      // GoldSrc ramp (accelerate 5, friction 4) to Sniper's 290 u/s covers ~245 units in the first second.
      expect(s1.tick - s0.tick).toBe(30);
      expect(moved).toBeGreaterThan(225);
      expect(moved).toBeLessThan(265);
      expect(s1.speed).toBeGreaterThan(280);
      expect(s1.position.z).toBeCloseTo(s1.groundZ, 1);

      await page.waitForFunction(() => window.__player!.state.speed < 1, undefined, { timeout: 10_000 });

      // --- scope + aim at the first dummy's head ---------------------------------------------
      await page.evaluate(() => window.__player!.press('scope'));
      await page.waitForFunction(() => window.__player!.state.zoomLevel === 1, undefined, { timeout: 5_000 });
      await page.evaluate(() => {
        const p = window.__player!;
        const s = p.state;
        const d = window.__dummies![0]!;
        const dx = d.x - s.eye.x;
        const dy = d.y - s.eye.y;
        const dz = d.headZ - s.eye.z;
        const dyaw = Math.atan2(Math.sin(Math.atan2(dy, dx) - s.yaw), Math.cos(Math.atan2(dy, dx) - s.yaw));
        p.look(dyaw, Math.atan2(dz, Math.hypot(dx, dy)) - s.pitch);
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/player-${map}-scoped.png` });

      const dummyId = await page.evaluate(() => window.__dummies![0]!.id);
      await page.evaluate(() => window.__player!.fire());
      await page.waitForFunction(() => window.__lastShot !== undefined, undefined, { timeout: 5_000 });
      const shot = await page.evaluate(() => window.__lastShot!);
      expect(shot.part).toBe('head');
      expect(shot.targetId).toBe(dummyId);
      expect(shot.blockedBy).toBeNull();

      // AWP: the scope drops after the shot and the rifle cycles the bolt.
      const s2 = await page.evaluate(() => window.__player!.state);
      expect(s2.shots).toBe(1);
      expect(s2.zoomLevel).toBe(0);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `test-results/player-${map}-after-shot.png` });

      expect(errors).toEqual([]);
    });
  });
}
