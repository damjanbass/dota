import { expect, test } from '@playwright/test';

// Every world view preset must render without console errors; screenshots are for visual review.
const VIEWS = ['sentinel_base', 'scourge_base', 'mid', 'river', 'roshan', 'showcase', 'showcase_units'];

for (const view of VIEWS) {
  test(`world view "${view}" renders`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/?scene=world&view=${view}&dpr=1`);
    await page.waitForFunction(() => window.__sceneReady === true, undefined, { timeout: 90_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/world-${view}.png` });
    const stats = await page.evaluate(() => window.__worldStats);
    console.log(`[world:${view}] ${JSON.stringify({ calls: stats?.drawCalls, tris: stats?.triangles, trees: stats?.trees, buildings: stats?.buildings })}`);
    expect(errors).toEqual([]);
  });
}

test('world night view renders', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?scene=world&view=mid&t=0.95&dpr=1');
  await page.waitForFunction(() => window.__sceneReady === true, undefined, { timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/world-mid-night.png' });
  expect(errors).toEqual([]);
});
