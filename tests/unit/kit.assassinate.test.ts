import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import type { Buff } from '../../src/core/sim';
import { SNIPER_ASSASSINATE, levelValue } from '../../src/data';
import { AssassinateAim } from '../../src/player/abilities/assassinate';
import { ASSASSINATE, ASSASSINATE_VISUAL, BUFF } from '../../src/player/abilities/ids';
import { createKitWorld, learnAll } from '../../src/player/abilities/testing/fixtures';

const setup = (distance = 2000) => {
  const w = createKitWorld({ level: 16 });
  learnAll(w);
  const enemy = w.sim.spawnHero('viper', 'scourge', distance, 0, { level: 25 });
  const buffs: Buff[] = [];
  const addBuff = w.sim.addBuff.bind(w.sim);
  w.sim.addBuff = (id, b) => {
    buffs.push(b);
    addBuff(id, b);
  };
  const aimTicks = Math.ceil(levelValue(SNIPER_ASSASSINATE, 'aimTime', 3) / SIM_DT - 1e-6);
  const casts = () => w.gameEvents.filter((e) => e.type === 'player:ability').length;
  return { w, enemy, buffs, aimTicks, casts };
};

describe('Assassinate aim lock', () => {
  it('fires after exactly aimTime on a visible enemy hero, then the homing bullet deals magic damage + ministun', () => {
    const { w, enemy, buffs, aimTicks, casts } = setup();
    w.player.lookAtUnit(enemy.id);
    w.player.input.press('assassinate');
    w.tick();
    expect(w.kit.aim.active).toBe(true);
    expect(w.kit.aim.targetId).toBe(enemy.id);
    // The rifle and the scope's RMB belong to the aim mode now.
    expect(w.player.input.bindings.fire).toEqual([]);
    w.tick(aimTicks - 2);
    expect(casts()).toBe(0);
    expect(w.kit.aimStatus).toBe('locking');
    w.tick();
    expect(casts()).toBe(1);
    expect(w.kit.aim.active).toBe(false);
    expect(w.player.input.bindings.fire).toEqual(['Mouse0']);
    expect(w.kitEvents.some((e) => e.type === 'assassinateFired' && e.targetId === enemy.id)).toBe(true);

    w.seconds(0.4); // cast point
    const launched = w.gameEvents.find((e) => e.type === 'projectile:launched')!.payload as { visual: string; speed: number; targetId: number };
    expect(launched.visual).toBe(ASSASSINATE_VISUAL);
    expect(launched.speed).toBe(levelValue(SNIPER_ASSASSINATE, 'projectileSpeed', 3));
    expect(launched.targetId).toBe(enemy.id);
    w.seconds(2000 / launched.speed + 0.2);
    const dmg = w.sim.damageLog.filter((d) => d.abilityId === ASSASSINATE);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.type).toBe('magical');
    expect(dmg[0]!.amount).toBeCloseTo(levelValue(SNIPER_ASSASSINATE, 'damage', 3) * (1 - enemy.def.magicResistance), 6);
    const stun = buffs.find((b) => b.id === BUFF.assassinateStun)!;
    expect(stun.stunned).toBe(true);
    expect(w.sim.player().hero!.cooldownReadyAt[ASSASSINATE]).toBeGreaterThan(w.sim.time);
  });

  it('losing the target resets the lock', () => {
    const { w, enemy, aimTicks, casts } = setup();
    w.player.lookAtUnit(enemy.id);
    w.player.input.press('assassinate');
    w.tick(Math.round(aimTicks * 0.7));
    expect(w.kit.aim.held).toBeGreaterThan(1);
    w.player.lookAt(enemy.position.x, enemy.position.y + 600, enemy.position.z + 60);
    w.tick(6); // > 0.1 s grace
    expect(w.kit.aim.targetId).toBeNull();
    expect(w.kit.aim.held).toBe(0);
    expect(w.kit.aimStatus).toBe('searching');
    w.player.lookAtUnit(enemy.id);
    w.tick(aimTicks - 1);
    expect(casts()).toBe(0);
    w.tick();
    expect(casts()).toBe(1);
  });

  it('a short slip inside the grace window keeps the lock', () => {
    const { w, enemy } = setup();
    w.player.lookAtUnit(enemy.id);
    w.player.input.press('assassinate');
    w.tick(20);
    w.player.lookAt(enemy.position.x, enemy.position.y + 600, enemy.position.z + 60);
    w.tick(2);
    w.player.lookAtUnit(enemy.id);
    w.tick();
    expect(w.kit.aim.targetId).toBe(enemy.id);
    expect(w.kit.aim.held).toBeCloseTo(21 * SIM_DT, 6);
  });

  it('ignores invisible, out-of-range and non-hero targets', () => {
    const { w, enemy } = setup();
    w.sim.hidden.add(enemy.id);
    w.player.lookAtUnit(enemy.id);
    w.player.input.press('assassinate');
    w.tick(60);
    expect(w.kit.aim.targetId).toBeNull();
    w.sim.hidden.clear();
    w.tick();
    expect(w.kit.aim.targetId).toBe(enemy.id);

    const far = setup(levelValue(SNIPER_ASSASSINATE, 'castRange', 3) * 2 + 200);
    far.w.player.lookAtUnit(far.enemy.id);
    far.w.player.input.press('assassinate');
    far.w.tick(10);
    expect(far.w.kit.aim.targetId).toBeNull();

    const creep = setup();
    const c = creep.w.sim.spawn('scourge_creep_melee', 'scourge', 1000, 300);
    creep.w.player.lookAtUnit(c.id);
    creep.w.player.input.press('assassinate');
    creep.w.tick(10);
    expect(creep.w.kit.aim.targetId).toBeNull();
  });

  it('R again or RMB cancels; no mana means no aim mode', () => {
    const { w, enemy, casts } = setup();
    w.player.lookAtUnit(enemy.id);
    w.player.input.press('assassinate');
    w.tick(5);
    w.player.input.press('assassinate');
    w.tick();
    expect(w.kit.aim.active).toBe(false);
    w.player.input.press('assassinate');
    w.tick(5);
    w.kit.cancel();
    w.tick();
    expect(w.kit.aim.active).toBe(false);
    expect(w.player.input.bindings.scope).toEqual(['Mouse2', 'KeyE']);
    w.tick(60);
    expect(casts()).toBe(0);

    w.sim.player().mana = 10;
    w.player.input.press('assassinate');
    w.tick();
    expect(w.kit.aim.active).toBe(false);
    expect(w.kitEvents.some((e) => e.type === 'message' && e.text === 'Not enough mana')).toBe(true);
  });

  it('AssassinateAim switches target instantly and restarts the lock', () => {
    const aim = new AssassinateAim();
    aim.start();
    expect(aim.update(0.5, 1, 1.5, 0.1)).toBe('locking');
    expect(aim.update(0.5, 2, 1.5, 0.1)).toBe('locking');
    expect(aim.held).toBe(0.5);
    expect(aim.update(1.0, 2, 1.5, 0.1)).toBe('fire');
    aim.cancel();
    expect(aim.update(1, 2, 1.5, 0.1)).toBe('idle');
  });
});
