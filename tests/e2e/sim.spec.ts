import { expect, test } from '@playwright/test';

// The sim dev scene runs the live simulation on the real map: creeps spawn and the speed controls work.
test('sim scene runs creep waves at 16x', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?scene=sim');
  await page.waitForFunction(() => window.__sceneReady === true, undefined, { timeout: 45_000 });
  await page.click('[data-testid="sim-16x"]');
  await page.waitForFunction(() => (window.__simDebug?.time ?? -99) > 20, undefined, { timeout: 30_000 });
  const creeps = await page.evaluate(() => window.__simDebug!.creeps);
  expect(creeps).toBeGreaterThan(10);
  await page.click('[data-testid="sim-mid"]');
  await page.screenshot({ path: 'test-results/sim-mid.png' });
  await page.click('[data-testid="sim-pause"]');
  const t0 = await page.evaluate(() => window.__simDebug!.time);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__simDebug!.time)).toBe(t0);
  expect(errors).toEqual([]);
});
