import { describe, expect, it } from 'vitest';
import { scaledRange } from '../../src/core/config';
import { SNIPER, SNIPER_TAKE_AIM, levelValue } from '../../src/data';
import { BUFF, TAKE_AIM } from '../../src/player/abilities/ids';
import { createKitWorld } from '../../src/player/abilities/testing/fixtures';

describe('Take Aim', () => {
  it('adds the range bonus only while scoped, and the rifle range follows the sim', () => {
    const w = createKitWorld({ level: 7 });
    for (let i = 0; i < 4; i++) expect(w.sim.learnAbility(w.heroId, TAKE_AIM)).toBe(true);
    const hero = w.sim.player();
    const base = scaledRange(SNIPER.attackRange);
    const bonus = levelValue(SNIPER_TAKE_AIM, 'bonusAttackRange', 4);

    w.tick();
    expect(hero.buffs.some((b) => b.id === BUFF.takeAim)).toBe(false);
    expect(w.player.stats.range).toBe(base);

    w.player.scope.isScoped = true;
    w.tick();
    const buff = hero.buffs.find((b) => b.id === BUFF.takeAim)!;
    expect(buff.attackRange).toBe(bonus); // unscaled; the sim scales the total
    expect(buff.expiresAt).toBe(Number.POSITIVE_INFINITY);
    expect(w.sim.stats(w.heroId).attackRange).toBe(scaledRange(SNIPER.attackRange + bonus));
    expect(w.player.stats.range).toBe(scaledRange(SNIPER.attackRange + bonus));

    // AWP bolt cycle drops the zoom for a moment; it's coming back, so the bonus stays.
    w.player.scope.isScoped = false;
    w.player.scope.resumeLevel = 1;
    w.tick();
    expect(w.player.stats.range).toBe(scaledRange(SNIPER.attackRange + bonus));

    w.player.scope.resumeLevel = 0;
    w.tick();
    expect(hero.buffs.some((b) => b.id === BUFF.takeAim)).toBe(false);
    expect(w.player.stats.range).toBe(base);
  });

  it('does nothing until learned and tracks level-ups while scoped', () => {
    const w = createKitWorld({ level: 7 });
    const hero = w.sim.player();
    w.player.scope.isScoped = true;
    w.tick();
    expect(hero.buffs).toHaveLength(0);
    expect(w.player.stats.range).toBe(scaledRange(SNIPER.attackRange));

    w.player.input.press('levelTakeAim');
    w.tick();
    expect(hero.hero!.skillLevels[TAKE_AIM]).toBe(1);
    w.tick();
    expect(hero.buffs.find((b) => b.id === BUFF.takeAim)!.attackRange).toBe(100);
    w.player.input.press('levelTakeAim');
    w.tick(2);
    expect(hero.buffs.find((b) => b.id === BUFF.takeAim)!.attackRange).toBe(200);
    expect(w.player.stats.range).toBe(scaledRange(SNIPER.attackRange + 200));
  });

  it('Ctrl+Q/E/R/G learn skills through the sim, which enforces required levels', () => {
    const w = createKitWorld({ level: 5 });
    const h = w.sim.player().hero!;
    w.player.input.press('levelAssassinate');
    w.tick();
    expect(h.skillLevels.sniper_assassinate).toBe(0);
    expect(w.kitEvents.some((e) => e.type === 'message' && /Can't learn Assassinate/.test(e.text))).toBe(true);
    for (const a of ['levelShrapnel', 'levelHeadshot', 'levelTakeAim', 'levelShrapnel', 'levelShrapnel'] as const) {
      w.player.input.press(a);
      w.tick();
    }
    expect(h.skillLevels).toMatchObject({ sniper_shrapnel: 3, sniper_headshot: 1, sniper_take_aim: 1 });
    expect(h.charges.sniper_shrapnel).toBe(3);
    // Shrapnel 4 needs hero level 7.
    w.player.input.press('levelShrapnel');
    w.tick();
    expect(h.skillLevels.sniper_shrapnel).toBe(3);
  });
});
