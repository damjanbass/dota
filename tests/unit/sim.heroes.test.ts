// Simulation: hero levels, respawn / buyback, abilities with charges, shops, runes, neutrals and vision.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { createMockMap } from '../../src/core/mockMap';
import { entitiesOfKind } from '../../src/core/map';
import { ITEMS, RUNES, buybackCost, respawnTime } from '../../src/data';
import { createSim } from '../../src/sim';
import { giveGold } from '../../src/sim/economy';
import { addXp } from '../../src/sim/heroes';
import { loadRealMap, testConfig } from '../../src/sim/testing';
import type { SimHero, SimUnit } from '../../src/sim/types';
import type { World } from '../../src/sim/world';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));

const run = (sim: World, seconds: number): void => {
  const end = sim.time + seconds;
  while (sim.time < end - 1e-9) sim.step(SIM_DT);
};

const quiet = (opts: { startTime?: number; allies?: string[]; enemies?: string[] } = {}): World =>
  createSim(createMockMap(), testConfig({ allies: opts.allies ?? [], enemies: opts.enemies ?? [] }), {
    startTime: opts.startTime ?? -60,
    neutrals: false,
    waves: false,
  }) as World;

const player = (sim: World): SimUnit => sim.player() as SimUnit;
const hero = (sim: World): SimHero => player(sim).hero!;
const killPlayer = (sim: World): void => {
  sim.dealDamage({ sourceId: null, targetId: player(sim).id, amount: 1e6, type: 'pure', isAttack: false });
};

describe('hero levels', () => {
  it('starts at level 1 with one skill point and 625 gold', () => {
    const sim = quiet();
    expect(hero(sim).level).toBe(1);
    expect(hero(sim).skillPoints).toBe(1);
    expect(sim.gold(player(sim).id)).toBe(625);
  });

  it('levelling up grants a skill point and respects requiredLevels', () => {
    const sim = quiet();
    const levels: number[] = [];
    sim.events.on('hero:levelUp', (e) => levels.push(e.level));
    const before = player(sim).maxHp;
    addXp(sim, player(sim), 200);
    expect(levels).toEqual([2]);
    expect(hero(sim).level).toBe(2);
    expect(hero(sim).skillPoints).toBe(2);
    expect(player(sim).maxHp).toBeGreaterThan(before);
    expect(sim.learnAbility(player(sim).id, 'sniper_assassinate')).toBe(false);
    expect(sim.learnAbility(player(sim).id, 'sniper_shrapnel')).toBe(true);
    // Shrapnel level 2 needs hero level 3.
    expect(sim.learnAbility(player(sim).id, 'sniper_shrapnel')).toBe(false);
    expect(sim.learnAbility(player(sim).id, 'sniper_headshot')).toBe(true);
    expect(hero(sim).skillPoints).toBe(0);
    addXp(sim, player(sim), 1800);
    expect(hero(sim).level).toBe(6);
    expect(sim.learnAbility(player(sim).id, 'sniper_assassinate')).toBe(true);
  });
});

describe('death, respawn and buyback', () => {
  it('respawns at the fountain after respawnTime(level)', () => {
    const sim = quiet();
    const spawn = { ...player(sim).position };
    sim.teleport(player(sim).id, 0, 0);
    killPlayer(sim);
    expect(player(sim).alive).toBe(false);
    expect(hero(sim).deaths).toBe(1);
    expect(hero(sim).respawnAt).toBeCloseTo(sim.time + respawnTime(1), 6);
    expect(sim.gold(player(sim).id)).toBe(625 - 30);
    run(sim, respawnTime(1) - 0.2);
    expect(player(sim).alive).toBe(false);
    run(sim, 0.3);
    expect(player(sim).alive).toBe(true);
    expect(player(sim).hp).toBe(player(sim).maxHp);
    expect(Math.hypot(player(sim).position.x - spawn.x, player(sim).position.y - spawn.y)).toBeLessThan(1);
  });

  it('buyback costs gold, revives now, has a 360 s cooldown and lengthens the next respawn', () => {
    const sim = quiet({ startTime: 600 });
    addXp(sim, player(sim), 5400);
    const level = hero(sim).level;
    giveGold(sim, player(sim), 3000, true, 'test');
    killPlayer(sim);
    run(sim, 2);
    const gold = sim.gold(player(sim).id);
    const cost = buybackCost(level, sim.time);
    expect(sim.buybackPrice(player(sim).id)).toBe(cost);
    const remaining = hero(sim).respawnAt! - sim.time;
    expect(sim.buyback(player(sim).id)).toBe(true);
    expect(player(sim).alive).toBe(true);
    expect(sim.gold(player(sim).id)).toBe(gold - cost);
    expect(sim.buybackCooldown(player(sim).id)).toBeCloseTo(360, 6);
    killPlayer(sim);
    expect(sim.buyback(player(sim).id)).toBe(false);
    expect(hero(sim).respawnAt! - sim.time).toBeCloseTo(respawnTime(level) + remaining * 0.25, 6);
  });

  it('the Aegis revives the holder in place without a death', () => {
    const sim = quiet();
    hero(sim).aegis = true;
    sim.teleport(player(sim).id, 100, 100);
    killPlayer(sim);
    expect(player(sim).alive).toBe(false);
    expect(hero(sim).deaths).toBe(0);
    run(sim, 5.1);
    expect(player(sim).alive).toBe(true);
    expect(player(sim).position.x).toBeCloseTo(100, 6);
    expect(hero(sim).aegis).toBe(false);
  });
});

describe('abilities', () => {
  it('charge abilities spend charges and restore one per chargeRestoreTime', () => {
    const sim = quiet();
    const casts: number[] = [];
    sim.registerAbility({ id: 'sniper_shrapnel', cast: () => casts.push(sim.time) });
    const id = player(sim).id;
    expect(sim.castAbility(id, 'sniper_shrapnel', { point: { x: 0, y: 0 } })).toEqual({ ok: false, reason: 'not learned' });
    sim.learnAbility(id, 'sniper_shrapnel');
    expect(hero(sim).charges.sniper_shrapnel).toBe(3);
    sim.teleport(id, 0, 0); // away from the fountain's mana aura
    const p = player(sim).position;
    const target = { point: { x: p.x + 500, y: p.y } };
    player(sim).mana = player(sim).maxMana;
    expect(sim.castAbility(id, 'sniper_shrapnel', target)).toEqual({ ok: true });
    expect(casts).toHaveLength(0);
    run(sim, 0.4);
    expect(casts).toHaveLength(1);
    expect(hero(sim).charges.sniper_shrapnel).toBe(2);
    expect(player(sim).mana).toBeCloseTo(player(sim).maxMana - 50, 0);
    player(sim).mana = player(sim).maxMana;
    sim.castAbility(id, 'sniper_shrapnel', target);
    run(sim, 0.4);
    player(sim).mana = player(sim).maxMana;
    sim.castAbility(id, 'sniper_shrapnel', target);
    run(sim, 0.4);
    expect(hero(sim).charges.sniper_shrapnel).toBe(0);
    expect(sim.castAbility(id, 'sniper_shrapnel', target)).toEqual({ ok: false, reason: 'charges' });
    expect(sim.chargeCooldown(id, 'sniper_shrapnel')).toBeGreaterThan(38);
    run(sim, 40);
    expect(hero(sim).charges.sniper_shrapnel).toBe(1);
    run(sim, 80);
    expect(hero(sim).charges.sniper_shrapnel).toBe(3);
    expect(sim.chargeCooldown(id, 'sniper_shrapnel')).toBe(0);
  });

  it('validates mana, cooldown, range, stun and silence', () => {
    const sim = quiet({ enemies: ['lion'] });
    const id = player(sim).id;
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    sim.registerAbility({ id: 'sniper_assassinate', cast: () => undefined });
    addXp(sim, player(sim), 2000);
    sim.learnAbility(id, 'sniper_assassinate');
    player(sim).mana = 100;
    sim.teleport(lion.id, player(sim).position.x + 1000, player(sim).position.y);
    expect(sim.castAbility(id, 'sniper_assassinate', { targetId: lion.id })).toEqual({ ok: false, reason: 'mana' });
    player(sim).mana = player(sim).maxMana;
    sim.teleport(lion.id, player(sim).position.x + 6000, player(sim).position.y);
    expect(sim.castAbility(id, 'sniper_assassinate', { targetId: lion.id })).toEqual({ ok: false, reason: 'out of range' });
    sim.teleport(lion.id, player(sim).position.x + 3000, player(sim).position.y);
    sim.addBuff(id, { id: 'silence', sourceId: null, expiresAt: sim.time + 1, silenced: true });
    expect(sim.castAbility(id, 'sniper_assassinate', { targetId: lion.id })).toEqual({ ok: false, reason: 'silenced' });
    run(sim, 1.1);
    expect(sim.castAbility(id, 'sniper_assassinate', { targetId: lion.id })).toEqual({ ok: true });
    run(sim, 0.4);
    expect(sim.castAbility(id, 'sniper_assassinate', { targetId: lion.id })).toEqual({ ok: false, reason: 'cooldown' });
  });

  it('a stun during the cast point cancels the cast and blocks setUnitPosition', () => {
    const sim = quiet();
    const id = player(sim).id;
    let cast = 0;
    sim.registerAbility({ id: 'sniper_shrapnel', cast: () => cast++ });
    sim.learnAbility(id, 'sniper_shrapnel');
    sim.castAbility(id, 'sniper_shrapnel', { point: { x: player(sim).position.x + 300, y: player(sim).position.y } });
    sim.addBuff(id, { id: 'stun', sourceId: null, expiresAt: sim.time + 1, stunned: true });
    const before = { ...player(sim).position };
    sim.setUnitPosition(id, { x: before.x + 50, y: before.y, z: before.z }, 0);
    expect(player(sim).position.x).toBe(before.x);
    run(sim, 0.5);
    expect(cast).toBe(0);
    expect(hero(sim).charges.sniper_shrapnel).toBe(3);
  });
});

describe('items and shops', () => {
  it('buys near a shop, auto-combines recipes and consumes Town Portal scrolls', () => {
    const sim = createSim(loadRealMap(DATA), testConfig(), { startTime: -60, neutrals: false, waves: false }) as World;
    const id = player(sim).id;
    const bought: string[] = [];
    sim.events.on('item:bought', (e) => bought.push(e.itemId));
    expect(sim.buyItem(id, 'boots_of_speed')).toEqual({ ok: true });
    expect(sim.gold(id)).toBe(625 - 450);
    expect(sim.buyItem(id, 'gloves_of_haste')).toEqual({ ok: false, reason: 'not enough gold' });
    giveGold(sim, player(sim), 2000, true, 'test');
    expect(sim.buyItem(id, 'gloves_of_haste')).toEqual({ ok: true });
    const goldBefore = sim.gold(id);
    expect(sim.buyItem(id, 'power_treads_agi')).toEqual({ ok: true });
    expect(sim.gold(id)).toBe(goldBefore - ITEMS.boots_of_elvenskin!.cost);
    expect(hero(sim).items.filter(Boolean)).toEqual(['power_treads_agi']);
    expect(sim.stats(id).moveSpeed).toBe(290 + 50);
    expect(sim.buyItem(id, 'tpscroll')).toEqual({ ok: true });
    expect(bought).toEqual(['boots_of_speed', 'gloves_of_haste', 'power_treads_agi', 'tpscroll']);

    let tp = 0;
    sim.registerAbility({ id: 'item_tpscroll', cast: () => tp++ });
    player(sim).mana = player(sim).maxMana;
    expect(sim.castAbility(id, 'item_tpscroll', { point: { x: 0, y: 0 } })).toEqual({ ok: true });
    expect(tp).toBe(1);
    expect(hero(sim).items.includes('tpscroll')).toBe(false);

    sim.teleport(id, 0, 0);
    expect(sim.buyItem(id, 'tpscroll')).toEqual({ ok: false, reason: 'no shop nearby' });
  });

  it('Healing Salve heals over time and is dispelled by enemy damage', () => {
    const sim = createSim(loadRealMap(DATA), testConfig({ enemies: ['lion'] }), { startTime: -60, neutrals: false, waves: false }) as World;
    const id = player(sim).id;
    expect(sim.buyItem(id, 'healing_salve')).toEqual({ ok: true });
    sim.teleport(id, 0, 0);
    player(sim).hp = 100;
    expect(sim.castAbility(id, 'item_healing_salve', {})).toEqual({ ok: true });
    expect(hero(sim).items.includes('healing_salve')).toBe(false);
    run(sim, 2);
    expect(player(sim).hp).toBeGreaterThan(170);
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    sim.dealDamage({ sourceId: lion.id, targetId: id, amount: 1, type: 'pure', isAttack: false });
    expect(player(sim).buffs.some((b) => b.id === 'item_healing_salve')).toBe(false);
  });
});

describe('runes', () => {
  it('first spawn is two bounty runes; pickup pays the first-spawn reward', () => {
    const sim = quiet({ startTime: -1 });
    run(sim, 1.1);
    const runes = sim.runes();
    expect(runes).toHaveLength(2);
    expect(runes.every((r) => r.kind === 'bounty')).toBe(true);
    const picked: string[] = [];
    sim.events.on('rune:picked', (e) => picked.push(e.kind));
    const gold = sim.gold(player(sim).id);
    sim.teleport(player(sim).id, runes[0]!.x + 20, runes[0]!.y);
    run(sim, 0.1);
    expect(picked).toEqual(['bounty']);
    expect(sim.gold(player(sim).id)).toBeGreaterThanOrEqual(gold + RUNES.bounty.firstSpawnGold);
    expect(hero(sim).xp).toBe(RUNES.bounty.firstSpawnXp);
    expect(sim.runes()).toHaveLength(1);
    sim.teleport(player(sim).id, 0, 0);
    run(sim, 120);
    const kinds = sim.runes().map((r) => r.kind);
    expect(kinds).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bounty')).toHaveLength(1);
  });

  it('Double Damage and Haste runes change stats', () => {
    const sim = quiet({ startTime: 125 });
    const id = player(sim).id;
    const base = sim.stats(id);
    sim.addBuff(id, { id: 'rune_double_damage', sourceId: id, expiresAt: sim.time + 45, damagePct: 1 });
    expect(sim.stats(id).damageMin).toBeCloseTo(base.damageMin * 2, 6);
    sim.addBuff(id, { id: 'rune_haste', sourceId: id, expiresAt: sim.time + 30, fixedMoveSpeed: 522 } as never);
    sim.addBuff(id, { id: 'slow', sourceId: null, expiresAt: sim.time + 30, moveSpeedPct: -0.5 });
    expect(sim.stats(id).moveSpeed).toBe(522);
  });
});

describe('neutrals and Roshan', () => {
  it('camps spawn at 0:30 unless blocked, Roshan exists from the start', () => {
    const map = createMockMap();
    const sim = createSim(map, testConfig(), { startTime: 25, waves: false }) as World;
    expect(sim.units().filter((u) => u.kind === 'roshan')).toHaveLength(1);
    const camps = entitiesOfKind(map, 'neutral_camp');
    sim.teleport(player(sim).id, camps[0]!.x, camps[0]!.y);
    run(sim, 5.5);
    const neutrals = sim.units().filter((u) => u.kind === 'neutral');
    expect(neutrals.length).toBeGreaterThan(20);
    const nearBlocked = neutrals.filter((u) => Math.hypot(u.position.x - camps[0]!.x, u.position.y - camps[0]!.y) < 500);
    expect(nearBlocked).toHaveLength(0);
  });

  it('killing Roshan gives the Aegis and team gold', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: 25, waves: false }) as World;
    const rosh = sim.units().find((u) => u.kind === 'roshan')!;
    const gold = sim.gold(player(sim).id);
    sim.dealDamage({ sourceId: player(sim).id, targetId: rosh.id, amount: 1e6, type: 'pure', isAttack: false });
    expect(rosh.alive).toBe(false);
    expect(hero(sim).aegis).toBe(true);
    expect(sim.gold(player(sim).id)).toBeGreaterThanOrEqual(gold + 200 + 150);
  });
});

describe('vision', () => {
  it('sees enemies inside vision range and not far away; day/night follows the 6.83d cycle', () => {
    const sim = quiet({ startTime: 1, enemies: ['lion'] });
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    expect(sim.isDay).toBe(true);
    const p = player(sim).position;
    sim.teleport(lion.id, p.x + 500, p.y);
    run(sim, 0.3);
    expect(sim.isVisibleTo('sentinel', lion.id)).toBe(true);
    expect(sim.isVisibleTo('scourge', player(sim).id)).toBe(true);
    sim.teleport(lion.id, -p.x, -p.y);
    run(sim, 0.3);
    expect(sim.isVisibleTo('sentinel', lion.id)).toBe(false);
    expect(sim.isVisibleTo('scourge', lion.id)).toBe(true);
    run(sim, 240);
    expect(sim.isDay).toBe(false);
    run(sim, 240);
    expect(sim.isDay).toBe(true);
  });
});
