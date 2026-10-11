// Simulation: damage pipeline, player rifle (last hits, denies, headshots), bounty and XP sharing.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { createMockMap } from '../../src/core/mockMap';
import type { DamageRequest, UnitState } from '../../src/core/sim';
import type { HitPart } from '../../src/core/types';
import { UNITS, armorMultiplier, attackTypeMultiplier } from '../../src/data';
import { createSim, hittablesFor } from '../../src/sim';
import { testConfig } from '../../src/sim/testing';
import type { SimUnit } from '../../src/sim/types';
import type { World } from '../../src/sim/world';

const run = (sim: World, seconds: number): void => {
  const end = sim.time + seconds;
  while (sim.time < end - 1e-9) sim.step(SIM_DT);
};

/** A quiet sim (no waves / neutrals) with the clock before the horn, so no passive gold flows. */
const quiet = (allies: string[] = [], enemies: string[] = []): World =>
  createSim(createMockMap(), testConfig({ allies, enemies }), { startTime: -60, neutrals: false, waves: false }) as World;

const shoot = (sim: World, target: UnitState, part: HitPart = 'body'): void => {
  const p = sim.player();
  sim.events.emit('player:shot', {
    origin: { x: p.position.x, y: p.position.y, z: p.position.z + 64 },
    direction: { x: 1, y: 0, z: 0 },
    result: { targetId: target.id, part, point: target.position, distance: 500, blockedBy: null },
  });
};

const near = (sim: World, defId: string, team: 'sentinel' | 'scourge', dx = 300): UnitState => {
  const p = sim.player().position;
  return sim.spawn(defId, team, p.x + dx, p.y + 40);
};

const gold = (sim: World, u: UnitState): number => sim.gold(u.id);

describe('damage pipeline', () => {
  it('physical attacks use the WC3 armor formula × attack type / armor type', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: 1, neutrals: false, waves: false }) as World;
    const t1 = sim.units().find((u) => u.kind === 'tower' && u.tier === 1 && u.team === 'scourge')!;
    const req: DamageRequest = { sourceId: null, targetId: t1.id, amount: 100, type: 'physical', isAttack: true, attackType: 'hero' };
    const expected = 100 * attackTypeMultiplier('hero', 'fortified') * armorMultiplier(UNITS.scourge_tower_t1!.armor);
    expect(sim.dealDamage(req)).toBeCloseTo(expected, 6);
    expect(expected).toBeCloseTo(100 * 0.5 * (1 / (1 + 0.06 * 20)), 6);
  });

  it('negative armor amplifies damage (2 - 0.94^-a)', () => {
    const sim = quiet();
    const creep = near(sim, 'scourge_creep_melee', 'scourge');
    sim.addBuff(creep.id, { id: 'test_armor', sourceId: null, expiresAt: Infinity, armor: -10 });
    const armor = UNITS.scourge_creep_melee!.armor - 10;
    expect(sim.stats(creep.id).armor).toBe(armor);
    const dealt = sim.dealDamage({ sourceId: null, targetId: creep.id, amount: 100, type: 'physical', isAttack: true, attackType: 'normal' });
    expect(dealt).toBeCloseTo(100 * (2 - Math.pow(0.94, -armor)) * attackTypeMultiplier('normal', 'unarmored'), 6);
    expect(dealt).toBeGreaterThan(100);
  });

  it('magical uses magic resistance, pure is unreduced, invulnerable / magic immune block', () => {
    const sim = quiet([], ['lion']);
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    expect(sim.dealDamage({ sourceId: null, targetId: lion.id, amount: 100, type: 'magical', isAttack: false })).toBeCloseTo(75, 6);
    expect(sim.dealDamage({ sourceId: null, targetId: lion.id, amount: 100, type: 'pure', isAttack: false })).toBeCloseTo(100, 6);
    sim.addBuff(lion.id, { id: 'bkb', sourceId: null, expiresAt: Infinity, magicImmune: true });
    expect(sim.dealDamage({ sourceId: null, targetId: lion.id, amount: 100, type: 'magical', isAttack: false })).toBe(0);
    expect(sim.dealDamage({ sourceId: null, targetId: lion.id, amount: 100, type: 'physical', isAttack: true, attackType: 'hero' })).toBeGreaterThan(0);
    sim.addBuff(lion.id, { id: 'ghost', sourceId: null, expiresAt: Infinity, invulnerable: true });
    expect(sim.dealDamage({ sourceId: null, targetId: lion.id, amount: 100, type: 'pure', isAttack: false })).toBe(0);
  });

  it('emits unit:damaged and unit:died with the killer', () => {
    const sim = quiet();
    const creep = near(sim, 'scourge_creep_ranged', 'scourge');
    const damaged: number[] = [];
    const died: Array<{ killerId: number | null; denied: boolean }> = [];
    sim.events.on('unit:damaged', (e) => damaged.push(e.amount));
    sim.events.on('unit:died', (e) => died.push(e));
    sim.dealDamage({ sourceId: sim.player().id, targetId: creep.id, amount: 10000, type: 'pure', isAttack: false });
    expect(damaged).toHaveLength(1);
    expect(died).toEqual([{ unitId: creep.id, killerId: sim.player().id, denied: false }]);
  });
});

describe('player rifle', () => {
  it('a last hit pays the bounty to the killer only', () => {
    const sim = quiet(['lion']);
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    sim.teleport(lion.id, sim.player().position.x + 100, sim.player().position.y);
    const creep = near(sim, 'scourge_creep_melee', 'scourge');
    creep.hp = 1;
    const before = gold(sim, sim.player());
    const allyBefore = gold(sim, lion);
    shoot(sim, creep);
    expect(creep.alive).toBe(false);
    const delta = gold(sim, sim.player()) - before;
    const def = UNITS.scourge_creep_melee!;
    expect(delta).toBeGreaterThanOrEqual(def.bountyGoldMin);
    expect(delta).toBeLessThanOrEqual(def.bountyGoldMax);
    expect(gold(sim, lion)).toBe(allyBefore);
    expect(sim.player().hero!.lastHits).toBe(1);
  });

  it('denies only work on allied creeps under 50% HP (towers under 10%)', () => {
    const sim = quiet();
    const creep = near(sim, 'sentinel_creep_melee', 'sentinel');
    creep.hp = creep.maxHp * 0.6;
    shoot(sim, creep);
    expect(creep.hp).toBeCloseTo(creep.maxHp * 0.6, 6);
    expect(hittablesFor(sim, 'sentinel').some((h) => h.id === creep.id)).toBe(false);
    creep.hp = creep.maxHp * 0.4;
    expect(hittablesFor(sim, 'sentinel').some((h) => h.id === creep.id)).toBe(true);
    shoot(sim, creep);
    expect(creep.hp).toBeLessThan(creep.maxHp * 0.4);
    creep.hp = 1;
    const before = gold(sim, sim.player());
    let denied = false;
    sim.events.on('unit:died', (e) => {
      if (e.unitId === creep.id) denied = e.denied;
    });
    shoot(sim, creep);
    expect(creep.alive).toBe(false);
    expect(denied).toBe(true);
    expect(gold(sim, sim.player())).toBe(before);
    expect(sim.player().hero!.denies).toBe(1);

    const tower = sim.units().find((u) => u.kind === 'tower' && u.team === 'sentinel' && u.tier === 1)! as SimUnit;
    tower.baseInvulnerable = false;
    sim.teleport(sim.player().id, tower.position.x + 400, tower.position.y);
    tower.hp = tower.maxHp * 0.3;
    shoot(sim, tower);
    expect(tower.hp).toBeCloseTo(tower.maxHp * 0.3, 6);
    tower.hp = tower.maxHp * 0.05;
    shoot(sim, tower);
    expect(tower.hp).toBeLessThan(tower.maxHp * 0.05);
  });

  it('a head hit reaches passive onAttack hooks with headshot: true', () => {
    const sim = quiet();
    const seen: DamageRequest[] = [];
    sim.registerAbility({ id: 'sniper_headshot', onAttack: (_ctx, req) => seen.push({ ...req }) });
    expect(sim.learnAbility(sim.player().id, 'sniper_headshot')).toBe(true);
    const creep = near(sim, 'scourge_creep_melee', 'scourge');
    shoot(sim, creep, 'head');
    shoot(sim, creep, 'body');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ headshot: true, isAttack: true, attackType: 'hero', sourceId: sim.player().id, targetId: creep.id });
    expect(seen[1]!.headshot).toBe(false);
  });

  it('onAttack can modify the request before damage is applied', () => {
    const sim = quiet();
    sim.registerAbility({
      id: 'sniper_headshot',
      onAttack: (ctx, req) => {
        if (req.headshot) req.amount += ctx.value('bonusDamage');
      },
    });
    sim.learnAbility(sim.player().id, 'sniper_headshot');
    const creep = near(sim, 'scourge_creep_melee', 'scourge');
    const hits: number[] = [];
    sim.events.on('unit:damaged', (e) => hits.push(e.amount));
    shoot(sim, creep, 'head');
    const st = sim.stats(sim.player().id);
    const mult = armorMultiplier(sim.stats(creep.id).armor) * attackTypeMultiplier('hero', 'unarmored');
    expect(hits[0]!).toBeGreaterThanOrEqual((st.damageMin + 15) * mult - 1e-6);
  });
});

describe('XP', () => {
  it('creep XP is split evenly among enemy heroes in range', () => {
    const sim = quiet(['lion']);
    const player = sim.player();
    const lion = sim.units().find((u) => u.def.id === 'lion')!;
    sim.teleport(lion.id, player.position.x + 150, player.position.y);
    const creep = near(sim, 'scourge_creep_melee', 'scourge');
    sim.dealDamage({ sourceId: player.id, targetId: creep.id, amount: 1e5, type: 'pure', isAttack: false });
    const xp = UNITS.scourge_creep_melee!.bountyXp;
    expect(player.hero!.xp).toBeCloseTo(xp / 2, 6);
    expect(lion.hero!.xp).toBeCloseTo(xp / 2, 6);

    sim.teleport(lion.id, player.position.x + 8000, player.position.y + 8000);
    const creep2 = near(sim, 'scourge_creep_melee', 'scourge');
    sim.dealDamage({ sourceId: player.id, targetId: creep2.id, amount: 1e5, type: 'pure', isAttack: false });
    expect(player.hero!.xp).toBeCloseTo(xp / 2 + xp, 6);
    expect(lion.hero!.xp).toBeCloseTo(xp / 2, 6);
  });

  it('creeps killed by other creeps still give XP; denies give only the small deny pool', () => {
    const sim = quiet([], ['lion']);
    const lion = sim.units().find((u) => u.def.id === 'lion')! as SimUnit;
    const p = sim.player().position;
    sim.teleport(lion.id, p.x + 200, p.y);
    const ally = near(sim, 'scourge_creep_melee', 'scourge', 250);
    const victim = near(sim, 'scourge_creep_melee', 'scourge', 350);
    sim.dealDamage({ sourceId: ally.id, targetId: victim.id, amount: 1e5, type: 'pure', isAttack: false });
    // Sniper (ranged) is the only enemy hero near the denied creep: the 20 XP ranged pool / 1 hero.
    expect(sim.player().hero!.xp).toBeCloseTo(20, 6);
    expect(lion.hero!.xp).toBe(0);
    const enemy = near(sim, 'sentinel_creep_melee', 'sentinel', 260);
    sim.dealDamage({ sourceId: ally.id, targetId: enemy.id, amount: 1e5, type: 'pure', isAttack: false });
    expect(lion.hero!.xp).toBeCloseTo(UNITS.sentinel_creep_melee!.bountyXp, 6);
  });

  it('time passes without error with heroes fighting creeps', () => {
    const sim = quiet([], ['pudge']);
    near(sim, 'scourge_creep_melee', 'scourge');
    run(sim, 5);
    expect(sim.time).toBeGreaterThan(-56);
  });
});
