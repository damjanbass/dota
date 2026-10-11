import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Screenshots of the HUD and every ?panel= of the ?scene=ui dev scene (fake sim), with no console errors.

const boot = async (page: Page, query: string): Promise<string[]> => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?scene=ui&test=1${query}`);
  await page.waitForFunction(() => window.__sceneReady === true, undefined, { timeout: 60_000 });
  return errors;
};

test('HUD at 720p: all parts render', async ({ page }) => {
  const errors = await boot(page, '');
  await page.waitForTimeout(1500);
  for (const sel of ['.hud-status', '.hud-minimap canvas', '.hud-abilities', '.hud-goldinv', '.hud-top', '.hud-feed .line', '.hud-world']) {
    await expect(page.locator(sel).first()).toBeVisible();
  }
  // 5 ability slots, 6 inventory slots, kill feed seeded by scripted kills.
  await expect(page.locator('.hud-slot')).toHaveCount(5);
  await expect(page.locator('.hud-inv .slot')).toHaveCount(6);
  expect(await page.locator('.hud-feed .line').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/ui-hud-720.png' });
  expect(errors).toEqual([]);
});

test('HUD at 1080p', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = await boot(page, '');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/ui-hud-1080.png' });
  expect(errors).toEqual([]);
});

for (const panel of ['menu', 'shop', 'scoreboard', 'death', 'end', 'pause'] as const) {
  test(`panel "${panel}"`, async ({ page }) => {
    const errors = await boot(page, `&panel=${panel}&freeze=1`);
    await page.waitForTimeout(1200);
    const selector = {
      menu: '.menu-main',
      shop: '.hud-shop.on',
      scoreboard: '.hud-score-panel.on',
      death: '.hud-death.on',
      end: '.ui-end',
      pause: '.menu-pause',
    }[panel];
    await expect(page.locator(selector)).toBeVisible();
    await page.screenshot({ path: `test-results/ui-${panel}.png` });
    expect(errors).toEqual([]);
  });
}

test('shop buys through the sim and reports failures', async ({ page }) => {
  const errors = await boot(page, '&panel=shop&freeze=1');
  await page.waitForTimeout(800);
  // Near the base shop: a Scroll of Town Portal is affordable.
  await page.locator('.hud-shop nav button[data-tab="consumables"]').click();
  await page.locator('.hud-shop .card[data-item="tpscroll"]').click();
  await page.locator('.hud-shop [data-act="buy"]').click();
  await expect(page.locator('.hud-shop .msg')).toContainText(/Bought|full/);
  // Secret-shop item from the base: the sim refuses with a reason.
  await page.locator('.hud-shop nav button[data-tab="secret"]').click();
  await page.locator('.hud-shop .card[data-item="hyperstone"]').dblclick();
  await expect(page.locator('.hud-shop .msg')).toContainText(/Secret Shop|gold/);
  await page.screenshot({ path: 'test-results/ui-shop-error.png' });
  expect(errors).toEqual([]);
});
