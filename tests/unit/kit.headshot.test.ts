import { describe, expect, it } from 'vitest';
import { SNIPER_HEADSHOT, armorMultiplier, attackTypeMultiplier, levelValue } from '../../src/data';
import { BUFF } from '../../src/player/abilities/ids';
import { createKitWorld, learnAll } from '../../src/player/abilities/testing/fixtures';

const setup = (seed = 7) => {
  const w = createKitWorld({ level: 16, seed });
  learnAll(w);
  const enemy = w.sim.spawnHero('lion', 'scourge', 800, 0, { level: 25 });
  const damaged: Array<{ amount: number; headshot: boolean }> = [];
  w.sim.events.on('unit:damaged', (e) => damaged.push({ amount: e.amount, headshot: e.headshot }));
  const attack = (headshot: boolean, amount = 50) =>
    w.sim.dealDamage({ sourceId: w.heroId, targetId: enemy.id, amount, type: 'physical', isAttack: true, attackType: 'hero', headshot });
  return { w, enemy, damaged, attack };
};

describe('Headshot', () => {
  it('a real headshot always procs: bonus damage, 100% slow, headshot flag on unit:damaged', () => {
    const { w, enemy, damaged, attack } = setup();
    const mult = attackTypeMultiplier('hero', 'hero') * armorMultiplier(w.sim.stats(enemy.id).armor);
    for (let i = 0; i < 25; i++) {
      enemy.hp = enemy.maxHp;
      attack(true);
    }
    expect(damaged).toHaveLength(25);
    for (const d of damaged) {
      expect(d.headshot).toBe(true);
      expect(d.amount).toBeCloseTo((50 + levelValue(SNIPER_HEADSHOT, 'bonusDamage', 4)) * mult, 6);
    }
    const slow = enemy.buffs.find((b) => b.id === BUFF.headshotSlow)!;
    expect(slow.moveSpeedPct).toBe(-1);
    expect(slow.expiresAt - w.sim.time).toBeCloseTo(levelValue(SNIPER_HEADSHOT, 'slowDuration', 4), 6);
    expect(w.sim.stats(enemy.id).moveSpeed).toBe(0);
    w.seconds(0.6);
    expect(enemy.buffs.some((b) => b.id === BUFF.headshotSlow)).toBe(false);
  });

  it('body shots proc about 40% of the time (seeded)', () => {
    for (const seed of [1, 2, 3]) {
      const { enemy, damaged, attack } = setup(seed);
      const n = 2000;
      for (let i = 0; i < n; i++) {
        enemy.hp = enemy.maxHp;
        attack(false);
      }
      const procs = damaged.filter((d) => d.headshot).length / n;
      expect(procs).toBeGreaterThan(0.37);
      expect(procs).toBeLessThan(0.43);
    }
    expect(levelValue(SNIPER_HEADSHOT, 'chance', 1)).toBe(0.4);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const { enemy, damaged, attack } = setup(42);
      for (let i = 0; i < 200; i++) {
        enemy.hp = enemy.maxHp;
        attack(false);
      }
      return damaged.map((d) => d.headshot);
    };
    expect(run()).toEqual(run());
  });

  it('never procs on structures, on spells, or before it is learned', () => {
    const { w, damaged } = setup();
    const tower = w.sim.spawn('scourge_tower_t1', 'scourge', 900, 0, { lane: 'mid', tier: 1 });
    w.sim.dealDamage({ sourceId: w.heroId, targetId: tower.id, amount: 50, type: 'physical', isAttack: true, attackType: 'hero', headshot: true });
    expect(damaged.at(-1)!.headshot).toBe(false);
    expect(tower.buffs).toHaveLength(0);

    const spell = { sourceId: w.heroId, targetId: tower.id, amount: 10, type: 'magical' as const, isAttack: false, headshot: false };
    w.sim.dealDamage(spell);
    expect(spell.headshot).toBe(false);

    const fresh = createKitWorld({ level: 1 });
    const e = fresh.sim.spawnHero('lion', 'scourge', 800, 0);
    let flagged = 0;
    fresh.sim.events.on('unit:damaged', (d) => (flagged += d.headshot ? 1 : 0));
    for (let i = 0; i < 50; i++) {
      e.hp = e.maxHp;
      fresh.sim.dealDamage({ sourceId: fresh.heroId, targetId: e.id, amount: 20, type: 'physical', isAttack: true, attackType: 'hero', headshot: false });
    }
    expect(flagged).toBe(0);
  });
});
