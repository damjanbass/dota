import { expect, test } from '@playwright/test';

// Every registered dev scene must boot without console errors and mark itself ready.
for (const scene of ['preview', 'world', 'fps']) {
  test(`scene "${scene}" boots`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/?scene=${scene}`);
    await page.waitForFunction(() => window.__sceneReady === true, undefined, { timeout: 45_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/smoke-${scene}.png` });
    expect(errors).toEqual([]);
  });
}
