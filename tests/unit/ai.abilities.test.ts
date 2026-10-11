import { describe, expect, it } from 'vitest';
import { scaledRange } from '../../src/core/config';
import { createMockMap } from '../../src/core/mockMap';
import type { UnitState } from '../../src/core/sim';
import {
  activeSkillshots,
  chooseRaze,
  HEX_BUFF,
  isChanneling,
  isToggledOn,
  nethertoxinBonus,
  POISON_BUFF,
  razeReady,
  registerHeroAbilities,
  registerNeutralAbilities,
  setPoisonAutocast,
  setStacks,
  SOULS_KEY,
  stacksOf,
} from '../../src/ai/abilities';
import { FakeSim } from '../../src/ai/testing/fakeSim';

const map = createMockMap();

const setup = (): FakeSim => {
  const sim = new FakeSim(map, { seed: 3 });
  registerHeroAbilities(sim);
  registerNeutralAbilities(sim);
  return sim;
};

/** Learns an ability at a level and gives plenty of mana. */
const learn = (u: UnitState, id: string, level: number): void => {
  u.hero!.skillLevels[id] = level;
  u.maxMana = 5000;
  u.mana = 5000;
};

const settle = (sim: FakeSim, seconds: number): void => sim.run(seconds);

/** Keeps a creep from auto-acquiring (a brain-controlled unit only acts on orders in the fake sim). */
const hold = (sim: FakeSim, u: UnitState): void => sim.registerBrain(u.id, { update: () => undefined });

const ORIGIN = { x: -2000, y: -1000 };
const at = (dx: number, dy = 0): [number, number] => [ORIGIN.x + dx, ORIGIN.y + dy];

describe('Pudge', () => {
  it('Meat Hook snags the first unit in line, damages it and drags it back', () => {
    const sim = setup();
    const pudge = sim.spawnHero('pudge', 'scourge', ...at(0));
    learn(pudge, 'pudge_meat_hook', 1);
    const creep = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(500));
    const hero = sim.spawnHero('lion', 'sentinel', ...at(800));
    const creepHp = creep.hp;
    expect(sim.castAbility(pudge.id, 'pudge_meat_hook', { point: { x: hero.position.x, y: hero.position.y } }).ok).toBe(true);
    settle(sim, 3);
    expect(hero.hp).toBe(hero.maxHp);
    expect(creepHp - creep.hp).toBeGreaterThan(88); // 90 magical vs a creep (no magic resistance), minus regen
    expect(creepHp - creep.hp).toBeLessThanOrEqual(90);
    expect(Math.hypot(creep.position.x - pudge.position.x, creep.position.y - pudge.position.y)).toBeLessThan(80);
    expect(activeSkillshots(sim)).toHaveLength(0);
  });

  it('Meat Hook reaches 900 × RANGE_SCALE at level 1 and drags a hero all the way back', () => {
    const sim = setup();
    const pudge = sim.spawnHero('pudge', 'scourge', ...at(0));
    learn(pudge, 'pudge_meat_hook', 1);
    const far = sim.spawnHero('lich', 'sentinel', ...at(scaledRange(900) - 60));
    const hp = far.hp;
    sim.castAbility(pudge.id, 'pudge_meat_hook', { point: { x: far.position.x, y: far.position.y } });
    settle(sim, 4);
    expect(hp - far.hp).toBeGreaterThan(90 * 0.75 - 3); // 25% hero magic resistance, minus regen
    expect(hp - far.hp).toBeLessThanOrEqual(90 * 0.75);
    expect(Math.hypot(far.position.x - pudge.position.x, far.position.y - pudge.position.y)).toBeLessThan(80);
    const tooFar = sim.spawnHero('viper', 'sentinel', ...at(0, scaledRange(900) + 150));
    sim.time += 20;
    sim.castAbility(pudge.id, 'pudge_meat_hook', { point: { x: tooFar.position.x, y: tooFar.position.y } });
    settle(sim, 4);
    expect(tooFar.hp).toBe(tooFar.maxHp);
  });

  it('Meat Hook misses a strafing player aimed at without lead', () => {
    const sim = setup();
    const pudge = sim.spawnHero('pudge', 'scourge', ...at(0));
    learn(pudge, 'pudge_meat_hook', 4);
    const player = sim.spawnHero('sniper', 'sentinel', ...at(1500), { isPlayer: true });
    sim.castAbility(pudge.id, 'pudge_meat_hook', { point: { x: player.position.x, y: player.position.y } });
    // Strafe sideways at Sniper's move speed (290) the moment the hook is thrown.
    for (let i = 0; i < 120; i++) {
      sim.setUnitPosition(player.id, { x: player.position.x, y: player.position.y + 290 / 30, z: 0 }, 0);
      sim.step();
    }
    expect(player.hp).toBe(player.maxHp);
  });

  it('Rot toggles, ticks every 0.2 s on Pudge and nearby enemies and slows them', () => {
    const sim = setup();
    const pudge = sim.spawnHero('pudge', 'scourge', ...at(0));
    learn(pudge, 'pudge_rot', 1);
    const near = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(250) - 40));
    const far = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(250) + 80));
    hold(sim, near);
    hold(sim, far);
    sim.castAbility(pudge.id, 'pudge_rot', {});
    expect(isToggledOn(sim, pudge.id, 'pudge_rot')).toBe(true);
    const pudgeHp = pudge.hp;
    const nearHp = near.hp;
    settle(sim, 1.1);
    expect(nearHp + 1.1 * near.def.hpRegen - near.hp).toBeCloseTo(35, 0);
    expect(far.hp).toBe(far.maxHp);
    expect(near.buffs.some((b) => b.id === 'pudge_rot' && b.moveSpeedPct === -0.2)).toBe(true);
    expect(pudge.hp).toBeLessThan(pudgeHp);
    sim.castAbility(pudge.id, 'pudge_rot', {});
    expect(isToggledOn(sim, pudge.id, 'pudge_rot')).toBe(false);
  });

  it('Dismember channels: stuns, deals damage per second and breaks when Pudge is stunned', () => {
    const sim = setup();
    const pudge = sim.spawnHero('pudge', 'scourge', ...at(0));
    learn(pudge, 'pudge_dismember', 1);
    const lion = sim.spawnHero('lion', 'sentinel', ...at(150));
    lion.maxHp = lion.hp = 5000;
    expect(sim.castAbility(pudge.id, 'pudge_dismember', { targetId: lion.id }).ok).toBe(true);
    settle(sim, 0.4);
    expect(isChanneling(sim, pudge.id)).toBe(true);
    expect(lion.buffs.some((b) => b.stunned)).toBe(true);
    const hp0 = lion.hp;
    settle(sim, 1);
    expect(hp0 - lion.hp).toBeCloseTo(75 * 0.75 - lion.def.hpRegen, 0);
    sim.addBuff(pudge.id, { id: 'test_stun', sourceId: null, expiresAt: sim.time + 1, stunned: true });
    settle(sim, 0.1);
    expect(isChanneling(sim, pudge.id)).toBe(false);
    expect(lion.buffs.some((b) => b.id === 'pudge_dismember')).toBe(false);
  });
});

describe('Lion', () => {
  it('Impale stuns and damages every enemy along the line once, not units beside it', () => {
    const sim = setup();
    const lion = sim.spawnHero('lion', 'scourge', ...at(0));
    learn(lion, 'lion_impale', 2);
    const a = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(400, 60));
    const b = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(700) - 50));
    const off = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(600, 400));
    sim.castAbility(lion.id, 'lion_impale', { point: { x: ORIGIN.x + 600, y: ORIGIN.y } });
    settle(sim, 0.3 + 0.2);
    expect(a.maxHp - a.hp).toBeCloseTo(140, 0);
    expect(a.buffs.some((x) => x.id === 'lion_impale' && x.stunned)).toBe(true);
    settle(sim, 1.2);
    expect(b.maxHp - b.hp).toBeGreaterThan(130);
    expect(off.hp).toBe(off.maxHp);
  });

  it('Voodoo silences and disarms (hex stand-in)', () => {
    const sim = setup();
    const lion = sim.spawnHero('lion', 'scourge', ...at(0));
    learn(lion, 'lion_voodoo', 1);
    const sf = sim.spawnHero('shadow_fiend', 'sentinel', ...at(400));
    sim.castAbility(lion.id, 'lion_voodoo', { targetId: sf.id });
    settle(sim, 0.4);
    const hex = sf.buffs.find((b) => b.id === HEX_BUFF)!;
    expect(hex.silenced).toBe(true);
    expect(sim.stats(sf.id).damageMax).toBe(0);
    expect(hex.expiresAt - sim.time).toBeCloseTo(2.5 - 0.1, 1);
  });

  it('Mana Drain moves mana each second and breaks out of range', () => {
    const sim = setup();
    const lion = sim.spawnHero('lion', 'scourge', ...at(0));
    learn(lion, 'lion_mana_drain', 4);
    lion.mana = 100;
    const sniper = sim.spawnHero('sniper', 'sentinel', ...at(500), { isPlayer: true });
    const m0 = sniper.mana;
    sim.castAbility(lion.id, 'lion_mana_drain', { targetId: sniper.id });
    settle(sim, 1.3);
    expect(m0 - sniper.mana).toBeGreaterThan(100);
    expect(lion.mana).toBeGreaterThan(190);
    sim.setUnitPosition(sniper.id, { x: ORIGIN.x + scaledRange(1200) + 100, y: ORIGIN.y, z: 0 }, 0);
    settle(sim, 0.1);
    expect(isChanneling(sim, lion.id)).toBe(false);
  });

  it('Finger of Death deals 600/725/850 magical damage', () => {
    const sim = setup();
    const lion = sim.spawnHero('lion', 'scourge', ...at(0));
    learn(lion, 'lion_finger_of_death', 1);
    const pudge = sim.spawnHero('pudge', 'sentinel', ...at(500), { level: 16 });
    pudge.maxHp = pudge.hp = 3000;
    sim.castAbility(lion.id, 'lion_finger_of_death', { targetId: pudge.id });
    settle(sim, 0.35);
    expect(3000 - pudge.hp).toBeCloseTo(600 * 0.75, 0);
  });
});

describe('Viper', () => {
  it('Poison Attack autocast spends 20 mana per attack on heroes and poisons', () => {
    const sim = setup();
    const viper = sim.spawnHero('viper', 'scourge', ...at(0));
    learn(viper, 'viper_poison_attack', 2);
    setPoisonAutocast(sim, viper.id, true);
    const enemy = sim.spawnHero('lion', 'sentinel', ...at(400));
    const mana = viper.mana;
    sim.order(viper.id, { type: 'attack', targetId: enemy.id });
    settle(sim, 1.2);
    expect(viper.mana).toBeLessThanOrEqual(mana - 20 + 5);
    const poison = enemy.buffs.find((b) => b.id === POISON_BUFF)!;
    expect(poison.moveSpeedPct).toBe(-0.2);
    expect(poison.dps).toEqual({ amount: 16, type: 'magical' });
  });

  it('Nethertoxin doubles per 20% missing HP from min to max', () => {
    expect(nethertoxinBonus(2.5, 40, 1)).toBe(2.5);
    expect(nethertoxinBonus(2.5, 40, 0.79)).toBe(5);
    expect(nethertoxinBonus(2.5, 40, 0.5)).toBe(10);
    expect(nethertoxinBonus(2.5, 40, 0.3)).toBe(20);
    expect(nethertoxinBonus(2.5, 40, 0.1)).toBe(40);
    expect(nethertoxinBonus(10, 160, 0)).toBe(160);
  });

  it('Corrosive Skin slows and poisons attackers', () => {
    const sim = setup();
    const viper = sim.spawnHero('viper', 'scourge', ...at(0));
    learn(viper, 'viper_corrosive_skin', 3);
    const lion = sim.spawnHero('lion', 'sentinel', ...at(400));
    sim.registerBrain(lion.id, { update: () => undefined });
    sim.order(lion.id, { type: 'attack', targetId: viper.id });
    settle(sim, 2);
    const b = lion.buffs.find((x) => x.id === 'viper_corrosive_skin')!;
    expect(b.moveSpeedPct).toBe(-0.2);
    expect(b.dps?.amount).toBe(20);
  });

  it('Viper Strike lands as a projectile and applies its slow/damage', () => {
    const sim = setup();
    const viper = sim.spawnHero('viper', 'scourge', ...at(0));
    learn(viper, 'viper_strike', 1);
    const lich = sim.spawnHero('lich', 'sentinel', ...at(900));
    sim.castAbility(viper.id, 'viper_strike', { targetId: lich.id });
    settle(sim, 0.35);
    expect(lich.buffs.some((b) => b.id === 'viper_strike')).toBe(false);
    settle(sim, 1);
    const b = lich.buffs.find((x) => x.id === 'viper_strike')!;
    expect(b.moveSpeedPct).toBe(-0.4);
    expect(b.dps?.amount).toBe(60);
  });
});

describe('Shadow Fiend', () => {
  it('Shadowraze hits at 200/450/700 (× RANGE_SCALE) in front, each raze on its own cooldown', () => {
    const sim = setup();
    const sf = sim.spawnHero('shadow_fiend', 'scourge', ...at(0));
    learn(sf, 'sf_shadowraze', 1);
    // Raze areas (radius 275) overlap like in DotA: 100 is only in the near one, 950 only in the far one,
    // 450 in all three.
    const near = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(100)));
    const mid = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(450)));
    const far = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(950)));
    const side = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(scaledRange(450), scaledRange(300)));
    const behind = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(-scaledRange(450)));
    for (const c of [near, mid, far, side, behind]) {
      c.maxHp = c.hp = 2000;
      hold(sim, c);
    }
    const aim = { x: ORIGIN.x + 1000, y: ORIGIN.y };
    chooseRaze(sim, sf.id, 0);
    sim.castAbility(sf.id, 'sf_shadowraze', { point: aim });
    settle(sim, 0.7);
    const lost = (c: UnitState): number => Math.round((2000 - c.hp) / 100);
    expect([lost(near), lost(mid), lost(far)]).toEqual([1, 1, 0]);
    expect(razeReady(sim, sf.id, 0)).toBe(false);
    expect(razeReady(sim, sf.id, 1)).toBe(true);
    // The other razes stay castable even though the sim's single cooldown was set.
    settle(sim, 0.1);
    chooseRaze(sim, sf.id, 1);
    expect(sim.castAbility(sf.id, 'sf_shadowraze', { point: aim }).ok).toBe(true);
    settle(sim, 0.7);
    expect([lost(near), lost(mid), lost(far)]).toEqual([1, 2, 0]);
    settle(sim, 0.1);
    chooseRaze(sim, sf.id, 2);
    expect(sim.castAbility(sf.id, 'sf_shadowraze', { point: aim }).ok).toBe(true);
    settle(sim, 0.7);
    expect([lost(near), lost(mid), lost(far)]).toEqual([1, 3, 1]);
    expect(lost(side)).toBe(0);
    expect(lost(behind)).toBe(0);
    settle(sim, 0.1);
    expect(sim.castAbility(sf.id, 'sf_shadowraze', { point: aim }).ok).toBe(false);
  });

  it('Necromastery stores a soul per kill (+2 damage each) and loses half on death', () => {
    const sim = setup();
    const sf = sim.spawnHero('shadow_fiend', 'scourge', ...at(0));
    learn(sf, 'sf_necromastery', 1);
    for (let i = 0; i < 4; i++) {
      const c = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(300, i * 10));
      sim.dealDamage({ sourceId: sf.id, targetId: c.id, amount: 9999, type: 'pure', isAttack: false });
    }
    settle(sim, 0.1);
    expect(stacksOf(sim, sf.id, SOULS_KEY)).toBe(4);
    expect(sf.buffs.find((b) => b.id === 'sf_necromastery')?.damage).toBe(8);
    sim.dealDamage({ sourceId: null, targetId: sf.id, amount: 99999, type: 'pure', isAttack: false });
    expect(stacksOf(sim, sf.id, SOULS_KEY)).toBe(2);
  });

  it('Requiem of Souls releases souls/2 lines after its cast time', () => {
    const sim = setup();
    const sf = sim.spawnHero('shadow_fiend', 'scourge', ...at(0));
    learn(sf, 'sf_requiem_of_souls', 1);
    setStacks(sim, sf.id, SOULS_KEY, 20);
    const close = sim.spawnHero('lion', 'sentinel', ...at(150));
    sim.castAbility(sf.id, 'sf_requiem_of_souls', {});
    settle(sim, 0.67 + 0.9);
    expect(close.hp).toBe(close.maxHp);
    settle(sim, 0.5);
    expect(activeSkillshots(sim).filter((s) => s.kind === 'requiem')).toHaveLength(10);
    expect(close.maxHp - close.hp).toBeGreaterThanOrEqual(80 * 0.75 - 1);
  });
});

describe('Lich', () => {
  it('Frost Nova hits the target for target + area damage and slows the area', () => {
    const sim = setup();
    const lich = sim.spawnHero('lich', 'scourge', ...at(0));
    learn(lich, 'lich_frost_nova', 1);
    const t = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(500));
    const side = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(500, scaledRange(200) - 20));
    sim.castAbility(lich.id, 'lich_frost_nova', { targetId: t.id });
    settle(sim, 0.45);
    expect(t.maxHp - t.hp).toBeCloseTo(125, 0);
    expect(side.maxHp - side.hp).toBeCloseTo(75, 0);
    expect(side.buffs.find((b) => b.id === 'frost_slow')?.moveSpeedPct).toBe(-0.3);
  });

  it('Frost Armor adds armor and frost-slows attackers', () => {
    const sim = setup();
    const lich = sim.spawnHero('lich', 'scourge', ...at(0));
    learn(lich, 'lich_frost_armor', 2);
    const armor0 = sim.stats(lich.id).armor;
    sim.castAbility(lich.id, 'lich_frost_armor', { targetId: lich.id });
    settle(sim, 0.45);
    expect(sim.stats(lich.id).armor - armor0).toBe(5);
    const creep = sim.spawn('sentinel_creep_melee', 'sentinel', ...at(80));
    sim.order(creep.id, { type: 'attack', targetId: lich.id });
    settle(sim, 1.2);
    expect(creep.buffs.some((b) => b.id === 'frost_slow')).toBe(true);
  });

  it('Dark Ritual sacrifices an allied creep for mana', () => {
    const sim = setup();
    const lich = sim.spawnHero('lich', 'scourge', ...at(0));
    learn(lich, 'lich_dark_ritual', 1);
    lich.mana = 100;
    const creep = sim.spawn('scourge_creep_melee', 'scourge', ...at(200));
    sim.castAbility(lich.id, 'lich_dark_ritual', { targetId: creep.id });
    settle(sim, 0.45);
    expect(creep.alive).toBe(false);
    expect(lich.mana).toBeCloseTo(100 - 25 + creep.def.hp * 0.25, -1);
  });

  it('Chain Frost bounces between enemies', () => {
    const sim = setup();
    const lich = sim.spawnHero('lich', 'scourge', ...at(0));
    learn(lich, 'lich_chain_frost', 1);
    const a = sim.spawnHero('lion', 'sentinel', ...at(600));
    const b = sim.spawnHero('viper', 'sentinel', ...at(900));
    a.maxHp = a.hp = b.maxHp = b.hp = 10000;
    sim.castAbility(lich.id, 'lich_chain_frost', { targetId: a.id });
    settle(sim, 6);
    const hitsA = Math.round((10000 - a.hp) / (280 * 0.75));
    const hitsB = Math.round((10000 - b.hp) / (280 * 0.75));
    expect(hitsA + hitsB).toBe(11);
    expect(Math.abs(hitsA - hitsB)).toBeLessThanOrEqual(1);
  });
});

describe('Roshan', () => {
  it('slams nearby enemies on its own and blocks one targeted spell every 15 s', () => {
    const sim = setup();
    const rosh = sim.spawn('roshan', 'neutral', ...at(0));
    const lion = sim.spawnHero('lion', 'sentinel', ...at(300));
    lion.maxHp = lion.hp = 5000;
    settle(sim, 0.6);
    const slow = lion.buffs.find((b) => b.id === 'roshan_slam');
    expect(slow?.moveSpeedPct).toBe(-0.5);
    expect(5000 - lion.hp).toBeGreaterThan(70 * 0.75 - 1);
    expect(rosh.buffs.some((b) => b.id === 'roshan_armor_growth' && b.armor === 0.5)).toBe(true);
    learn(lion, 'lion_finger_of_death', 1);
    const hp = rosh.hp;
    sim.castAbility(lion.id, 'lion_finger_of_death', { targetId: rosh.id });
    settle(sim, 0.35);
    expect(rosh.hp).toBeGreaterThan(hp - 50);
  });
});
