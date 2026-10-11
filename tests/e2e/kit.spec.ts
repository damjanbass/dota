import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Drives ?scene=kit headless through window.__player (C's input hooks), window.__kit and window.__kitDev.
// Fast runs use ?world=dev (C's debug terrain); one test renders agent D's world for screenshots.

const boot = async (page: Page, query = ''): Promise<string[]> => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`/?scene=kit&test=1&dpr=1${query}`);
  await page.waitForFunction(() => window.__sceneReady === true && !!window.__kit && !!window.__kitDev && !!window.__player, undefined, { timeout: 90_000 });
  await page.waitForTimeout(300);
  return errors;
};

/** Turns the view so the crosshair points at a world point. */
const lookAt = async (page: Page, x: number, y: number, z: number): Promise<void> => {
  await page.evaluate(
    ([tx, ty, tz]) => {
      const p = window.__player!;
      const s = p.state;
      const dx = tx! - s.eye.x;
      const dy = ty! - s.eye.y;
      const dz = tz! - s.eye.z;
      const yaw = Math.atan2(dy, dx);
      const dyaw = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw));
      p.look(dyaw, Math.atan2(dz, Math.hypot(dx, dy)) - s.pitch);
    },
    [x, y, z],
  );
};

const unit = async (page: Page, name: string) => {
  const u = await page.evaluate((n) => window.__kitDev!.units().find((x) => x.name === n && x.alive), name);
  expect(u, `unit ${name}`).toBeDefined();
  return u!;
};

test.describe('sniper kit', () => {
  test('Q Shrapnel: crosshair ground point → field with ticks, shells and dust', async ({ page }) => {
    const errors = await boot(page, '&world=dev');
    const pudge = await unit(page, 'Pudge');
    // Head height: the dev range stands on the high ground and the river cliff lip grazes lower lines of sight.
    await lookAt(page, pudge.x, pudge.y, pudge.headZ);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test-results/kit-shrapnel-preview.png' });
    const before = await page.evaluate(() => window.__kit!.state.charges);
    await page.evaluate(() => window.__player!.press('shrapnel'));
    await page.waitForFunction(() => window.__kit!.state.fields.length > 0, undefined, { timeout: 5_000 });
    const s = await page.evaluate(() => window.__kit!.state);
    expect(s.charges).toBe(before - 1);
    expect(Math.hypot(s.fields[0]!.x - pudge.x, s.fields[0]!.y - pudge.y)).toBeLessThan(80);
    await page.waitForFunction(() => window.__kit!.state.fields[0]!.ticksDone >= 2, undefined, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__kit!.state.shrapnelVisuals)).toBe(1);
    await page.screenshot({ path: 'test-results/kit-shrapnel-field.png' });
    const hurt = await unit(page, 'Pudge');
    expect(hurt.hp).toBeLessThan(hurt.maxHp);
    expect(errors).toEqual([]);
  });

  test('R Assassinate: lock on a hero → homing bullet hits', async ({ page }) => {
    const errors = await boot(page, '&world=dev');
    const viper = await unit(page, 'Viper');
    await lookAt(page, viper.x, viper.y, viper.chestZ);
    await page.evaluate(() => window.__player!.press('assassinate'));
    await page.waitForFunction(() => window.__kit!.state.aim.targetId !== null && window.__kit!.state.aim.progress > 0.4, undefined, { timeout: 5_000 });
    await page.screenshot({ path: 'test-results/kit-assassinate-lock.png' });
    await page.waitForFunction(() => window.__kit!.state.bulletsLaunched > 0, undefined, { timeout: 8_000 });
    const s = await page.evaluate(() => window.__kit!.state);
    expect(s.aim.active).toBe(false);
    expect(s.cooldowns.sniper_assassinate).toBeGreaterThan(5);
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/kit-assassinate-bullet.png' });
    await page.waitForFunction((id) => window.__kitDev!.units().find((u) => u.id === id)!.hp < window.__kitDev!.units().find((u) => u.id === id)!.maxHp, viper.id, { timeout: 8_000 });
    expect(await page.evaluate(() => window.__kitDev!.events.some((e) => e.includes('assassinate')))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('E Take Aim: scoping raises the rifle range through the sim', async ({ page }) => {
    const errors = await boot(page, '&world=dev');
    const r0 = await page.evaluate(() => window.__kit!.state.range);
    await page.evaluate(() => window.__player!.press('scope'));
    await page.waitForFunction(() => window.__kit!.state.takeAimBonus > 0, undefined, { timeout: 3_000 });
    const s = await page.evaluate(() => window.__kit!.state);
    expect(s.range).toBe(r0 + 2 * s.takeAimBonus);
    expect(errors).toEqual([]);
  });

  test('F Town Portal: map overlay opens, click a tower, channel, land next to it', async ({ page }) => {
    const errors = await boot(page, '&world=dev');
    await page.evaluate(() => window.__player!.press('townPortal'));
    await page.waitForFunction(() => window.__kit!.state.tp.overlayOpen, undefined, { timeout: 3_000 });
    await expect(page.locator('.kit-map')).toBeVisible();
    // Hover then click near the Sentinel bottom tier-1 tower (any allied structure works).
    const target = await page.evaluate(() => {
      const anchors = window.__kitDev!.anchors();
      return anchors.find((a) => a.name === 'tower:bot:1') ?? anchors[0]!;
    });
    const pt = await page.evaluate(([x, y]) => window.__kit!.tpScreenPoint(x!, y! + 150), [target.x, target.y]);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: 'test-results/kit-tp-map.png' });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction(() => window.__kit!.state.tp.channeling, undefined, { timeout: 3_000 });
    expect(await page.evaluate(() => window.__kit!.state.tp.overlayOpen)).toBe(false);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/kit-tp-channel.png' });
    // The sim teleports at the end of its tick; the FPS controller follows on the next kit update.
    await page.waitForFunction(
      () => {
        const t = window.__kit!.state;
        return t.tp.status === 'done' && Math.hypot(t.position.x - t.tp.landing!.x, t.position.y - t.tp.landing!.y) < 1;
      },
      undefined,
      { timeout: 6_000 },
    );
    const s = await page.evaluate(() => window.__kit!.state);
    const d = Math.hypot(s.position.x - target.x, s.position.y - target.y);
    expect(d).toBeGreaterThanOrEqual(119);
    expect(d).toBeLessThanOrEqual(576);
    expect(s.items.filter((i) => i === 'tpscroll')).toHaveLength(2);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/kit-tp-arrived.png' });

    // A second TP is on cooldown: the map doesn't open.
    await page.evaluate(() => window.__player!.press('townPortal'));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__kit!.state.tp.overlayOpen)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('moving cancels a TP channel', async ({ page }) => {
    const errors = await boot(page, '&world=dev');
    await page.evaluate(() => window.__player!.press('townPortal'));
    await page.waitForFunction(() => window.__kit!.state.tp.overlayOpen, undefined, { timeout: 3_000 });
    const a = await page.evaluate(() => window.__kitDev!.anchors()[0]!);
    await page.evaluate(([x, y]) => window.__kit!.chooseTp(x!, y!), [a.x, a.y]);
    await page.waitForFunction(() => window.__kit!.state.tp.channeling, undefined, { timeout: 3_000 });
    await page.evaluate(() => window.__player!.hold(['forward'], 0.2));
    await page.waitForFunction(() => window.__kit!.state.tp.status === 'cancelled', undefined, { timeout: 3_000 });
    expect(errors).toEqual([]);
  });

  test('world render: Shrapnel and Assassinate on agent D terrain', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = await boot(page, '&shadows=0');
    const pudge = await unit(page, 'Pudge');
    await lookAt(page, pudge.x + 60, pudge.y, pudge.z);
    await page.evaluate(() => window.__player!.press('shrapnel'));
    await page.waitForFunction(() => window.__kit!.state.fields.length > 0 && window.__kit!.state.fields[0]!.ticksDone >= 1, undefined, { timeout: 15_000 });
    await page.screenshot({ path: 'test-results/kit-world-shrapnel.png' });
    const lion = await unit(page, 'Lion');
    await lookAt(page, lion.x, lion.y + 400, lion.chestZ + 200);
    await page.evaluate(() => window.__player!.press('assassinate'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/kit-world-assassinate-search.png' });
    expect(await page.evaluate(() => window.__kit!.state.aim.status)).toBe('searching');
    expect(errors).toEqual([]);
  });
});
