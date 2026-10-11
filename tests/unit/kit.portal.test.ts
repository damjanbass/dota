import { describe, expect, it } from 'vitest';
import { isWalkable } from '../../src/core/map';
import { ITEM_TPSCROLL_ABILITY, levelValue } from '../../src/data';
import { TOWN_PORTAL, TP_ITEM } from '../../src/player/abilities/ids';
import { createKitWorld } from '../../src/player/abilities/testing/fixtures';
import { PORTAL_MIN_LANDING, portalAnchors, portalLanding } from '../../src/player/abilities/townPortal';
import { createTestMap } from '../../src/player/testing';

const setup = () => {
  const w = createKitWorld({ level: 6 });
  const mid = w.sim.spawn('sentinel_tower_t1', 'sentinel', 3000, 0, { lane: 'mid', tier: 1 });
  const top = w.sim.spawn('sentinel_tower_t2', 'sentinel', -2000, 2500, { lane: 'top', tier: 2 });
  w.sim.spawn('scourge_tower_t1', 'scourge', 2600, 400, { lane: 'mid', tier: 1 });
  w.sim.addItem(w.heroId, TP_ITEM);
  return { w, mid, top };
};

const startTp = (w: ReturnType<typeof setup>['w'], x: number, y: number) => {
  w.player.input.press('townPortal');
  w.tick();
  expect(w.kit.tpOverlayOpen).toBe(true);
  expect(w.kit.chooseTp({ x, y })).toBe(true);
  expect(w.kit.tpOverlayOpen).toBe(false);
  w.tick(2);
};

describe('Town Portal', () => {
  it('channels 3 s and lands next to the allied structure nearest the clicked point', () => {
    const { w, mid } = setup();
    startTp(w, 3100, 350);
    const ch = w.kit.channel()!;
    expect(ch).not.toBeNull();
    expect(ch.anchor.unitId).toBe(mid.id);
    expect(ch.endAt - ch.startAt).toBe(levelValue(ITEM_TPSCROLL_ABILITY, 'channelTime', 1));
    const hero = w.sim.player();
    // Scroll used, mana and cooldown spent at the start (a cancelled TP is wasted).
    expect(hero.hero!.items).not.toContain(TP_ITEM);
    expect(hero.mana).toBeLessThan(hero.maxMana - levelValue(ITEM_TPSCROLL_ABILITY, 'manaCost', 1) + 5);
    expect(hero.hero!.cooldownReadyAt[TOWN_PORTAL]).toBeGreaterThan(w.sim.time + 60);

    w.seconds(2.8);
    expect(w.player.controller.teleports).toBe(0);
    w.seconds(0.3);
    expect(w.player.controller.teleports).toBe(1);
    const p = w.player.controller.position;
    const d = Math.hypot(p.x - mid.position.x, p.y - mid.position.y);
    expect(d).toBeGreaterThanOrEqual(PORTAL_MIN_LANDING - 1e-6);
    expect(d).toBeLessThanOrEqual(levelValue(ITEM_TPSCROLL_ABILITY, 'landingMaxDistance', 1));
    expect(Math.atan2(p.y - mid.position.y, p.x - mid.position.x)).toBeCloseTo(Math.atan2(350, 100), 1);
    expect(hero.position.x).toBeCloseTo(p.x, 6);
    expect(hero.position.y).toBeCloseTo(p.y, 6);
    expect(w.kitEvents.some((e) => e.type === 'tpArrived')).toBe(true);
  });

  it('moving (WASD) cancels the channel: no teleport, scroll still consumed', () => {
    const { w } = setup();
    startTp(w, 3000, -300);
    w.seconds(1);
    w.player.input.held.add('forward');
    w.tick();
    w.player.input.held.clear();
    expect(w.kit.channel()).toBeNull();
    expect(w.kitEvents.some((e) => e.type === 'tpCancelled' && e.reason === 'Moved')).toBe(true);
    w.seconds(3);
    expect(w.player.controller.teleports).toBe(0);
    expect(w.sim.player().hero!.items).not.toContain(TP_ITEM);
  });

  it('stun, silence or being displaced cancels it', () => {
    for (const cause of ['Stunned', 'Silenced', 'Moved'] as const) {
      const { w } = setup();
      startTp(w, 3000, 0);
      w.seconds(0.5);
      const hero = w.sim.player();
      if (cause === 'Stunned') w.sim.addBuff(hero.id, { id: 'test', sourceId: null, expiresAt: w.sim.time + 1, stunned: true });
      if (cause === 'Silenced') w.sim.addBuff(hero.id, { id: 'test', sourceId: null, expiresAt: w.sim.time + 1, silenced: true });
      if (cause === 'Moved') w.player.controller.position.x += 200; // knocked away without input
      w.tick(2);
      expect(w.kitEvents.some((e) => e.type === 'tpCancelled' && e.reason === cause)).toBe(true);
      w.seconds(3);
      expect(w.player.controller.teleports).toBe(0);
    }
  });

  it('needs a scroll and an off-cooldown TP before the map opens', () => {
    const w = createKitWorld({ level: 6 });
    w.player.input.press('townPortal');
    w.tick();
    expect(w.kit.tpOverlayOpen).toBe(false);
    expect(w.kitEvents.some((e) => e.type === 'message' && /Town Portal Scroll/.test(e.text))).toBe(true);
  });

  it('F toggles the map; casting another spell interrupts the channel', () => {
    const { w } = setup();
    w.sim.learnAbility(w.heroId, 'sniper_shrapnel');
    w.player.input.press('townPortal');
    w.tick();
    w.player.input.press('townPortal');
    w.tick();
    expect(w.kit.tpOverlayOpen).toBe(false);
    startTp(w, 3000, 0);
    w.player.lookAt(800, 0, 0);
    w.player.input.press('shrapnel');
    w.tick();
    expect(w.kitEvents.some((e) => e.type === 'tpCancelled' && e.reason === 'Interrupted')).toBe(true);
  });

  it('landing spots stay on walkable ground and use the map fallback when the sim has no structures', () => {
    // Unwalkable block on the clicked side of the tower: the landing fans out to walkable ground.
    const map = createTestMap({ half: 2048, pathing: (x, y) => (x > 1100 && x < 1500 && y > -200 && y < 200 ? 0x02 : 0) });
    const anchor = { unitId: 1, x: 1000, y: 0, kind: 'tower', name: 'T', radius: 64 };
    const land = portalLanding(map, anchor, { x: 1400, y: 0 }, 575, { x: -2000, y: 0 });
    expect(isWalkable(map, land.x, land.y)).toBe(true);
    expect(Math.hypot(land.x - 1000, land.y)).toBeGreaterThanOrEqual(PORTAL_MIN_LANDING);
    expect(Math.hypot(land.x - 1000, land.y)).toBeLessThanOrEqual(575);

    const w = createKitWorld({ level: 1 });
    w.map.data.entities.push({ id: 9, kind: 'tower', team: 'sentinel', lane: 'bot', tier: 1, x: 1500, y: -1500, z: 0, facing: 0, typeId: 'e00R', name: 'Tower' });
    const anchors = portalAnchors(w.sim, 'sentinel');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.unitId).toBeNull();
    expect(anchors[0]!.name).toBe('Bot Tier 1 Tower');
  });
});
