import { describe, expect, it } from 'vitest';
import { SIM_DT, scaledRange } from '../../src/core/config';
import { SNIPER_SHRAPNEL, levelValue } from '../../src/data';
import { BUFF, SHRAPNEL } from '../../src/player/abilities/ids';
import { createKitWorld, learnAll } from '../../src/player/abilities/testing/fixtures';
import type { KitWorld } from '../../src/player/abilities/testing/fixtures';

const hits = (w: KitWorld, targetId: number) => w.sim.damageLog.filter((d) => d.targetId === targetId && d.abilityId === SHRAPNEL);

const setup = () => {
  const w = createKitWorld({ level: 16 });
  learnAll(w);
  const enemy = w.sim.spawnHero('pudge', 'scourge', 1500, 0, { level: 25 });
  return { w, enemy };
};

describe('Shrapnel', () => {
  it('lands under the crosshair after the cast point and deals 10 magical ticks from 0.8 s', () => {
    const { w, enemy } = setup();
    w.player.lookAt(1500, 120, 0); // ground just beside the enemy
    w.player.input.press('shrapnel');
    w.tick();
    expect(w.kitEvents.some((e) => e.type === 'shrapnelCast')).toBe(true);
    expect(w.gameEvents.some((e) => e.type === 'player:ability')).toBe(true);

    // Cast point 0.3 s: the field appears, but no damage until 0.8 s later.
    w.seconds(0.3);
    const field = w.kit.systems.shrapnel.fields[0]!;
    expect(field).toBeDefined();
    expect(Math.hypot(field.x - 1500, field.y - 120)).toBeLessThan(2);
    w.seconds(0.7);
    expect(hits(w, enemy.id)).toHaveLength(0);
    expect(enemy.buffs.some((b) => b.id === BUFF.shrapnelSlow)).toBe(false);
    w.seconds(0.2);
    expect(hits(w, enemy.id)).toHaveLength(1);

    w.seconds(12);
    const h = hits(w, enemy.id);
    expect(h).toHaveLength(levelValue(SNIPER_SHRAPNEL, 'ticks', 4));
    const perTick = levelValue(SNIPER_SHRAPNEL, 'damagePerSecond', 4) * (1 - enemy.def.magicResistance);
    for (const d of h) {
      expect(d.type).toBe('magical');
      expect(d.amount).toBeCloseTo(perTick, 6);
    }
    // 1 s apart, first at castPoint + 0.8.
    const t0 = h[0]!.t;
    h.forEach((d, i) => expect(d.t - t0).toBeCloseTo(i, 1));
    expect(w.kit.systems.shrapnel.fields).toHaveLength(0);
  });

  it('slows enemies inside (refreshed per tick) and wears off after leaving', () => {
    const { w, enemy } = setup();
    w.player.lookAt(1500, 0, 0);
    const baseSpeed = w.sim.stats(enemy.id).moveSpeed;
    w.player.input.press('shrapnel');
    w.seconds(1.3);
    const slow = enemy.buffs.find((b) => b.id === BUFF.shrapnelSlow)!;
    expect(slow.moveSpeedPct).toBe(-levelValue(SNIPER_SHRAPNEL, 'moveSlow', 4));
    expect(w.sim.stats(enemy.id).moveSpeed).toBeCloseTo(baseSpeed * 0.7, 6);
    w.seconds(3);
    expect(enemy.buffs.find((b) => b.id === BUFF.shrapnelSlow)!.expiresAt).toBeGreaterThan(w.sim.time + 1);

    // Walk out of the field: no more damage, the slow expires within slowDuration.
    w.sim.teleport(enemy.id, 3000, 0);
    const before = hits(w, enemy.id).length;
    w.seconds(2.1);
    expect(hits(w, enemy.id)).toHaveLength(before);
    expect(enemy.buffs.some((b) => b.id === BUFF.shrapnelSlow)).toBe(false);
  });

  it('never damages or slows structures, allies or the caster', () => {
    const { w } = setup();
    const tower = w.sim.spawn('scourge_tower_t1', 'scourge', 1500, 200, { lane: 'mid', tier: 1 });
    const ally = w.sim.spawn('sentinel_creep_melee', 'sentinel', 1400, -100);
    w.player.lookAt(1500, 0, 0);
    w.player.input.press('shrapnel');
    w.seconds(12);
    expect(levelValue(SNIPER_SHRAPNEL, 'buildingDamagePct', 1)).toBe(0);
    expect(hits(w, tower.id)).toHaveLength(0);
    expect(tower.hp).toBe(tower.maxHp);
    expect(hits(w, ally.id)).toHaveLength(0);
    expect(hits(w, w.heroId)).toHaveLength(0);
  });

  it('overlapping fields do not stack on the same unit (1.1 s lockout)', () => {
    const { w, enemy } = setup();
    w.player.lookAt(1500, 0, 0);
    w.player.input.press('shrapnel');
    w.seconds(0.5);
    w.player.input.press('shrapnel');
    w.seconds(13);
    expect(w.sim.player().hero!.charges[SHRAPNEL]).toBe(1);
    expect(hits(w, enemy.id)).toHaveLength(10);
  });

  it('uses charges: 3 casts, then refused until a charge restores 40 s later', () => {
    const { w } = setup();
    w.player.lookAt(1500, 0, 0);
    for (let i = 0; i < 3; i++) {
      w.player.input.press('shrapnel');
      w.seconds(0.5);
    }
    const hero = w.sim.player().hero!;
    expect(hero.charges[SHRAPNEL]).toBe(0);
    w.kitEvents.length = 0;
    w.player.input.press('shrapnel');
    w.tick();
    expect(w.kitEvents.some((e) => e.type === 'message' && /charges/.test(e.text))).toBe(true);
    w.seconds(levelValue(SNIPER_SHRAPNEL, 'chargeRestoreTime', 4) - 1.5 + 0.5); // first charge was spent after the 0.3 s cast point
    expect(hero.charges[SHRAPNEL]).toBe(1);
  });

  it('aiming at the sky clamps the target to max cast range along the view', () => {
    const { w } = setup();
    w.player.controller.yaw = Math.PI / 2;
    w.player.controller.pitch = 0.6;
    const aim = w.kit.shrapnelAim();
    expect(aim.clamped).toBe(true);
    const range = scaledRange(levelValue(SNIPER_SHRAPNEL, 'castRange', 4));
    expect(Math.hypot(aim.x, aim.y)).toBeLessThanOrEqual(range);
    expect(Math.hypot(aim.x, aim.y)).toBeGreaterThan(range - 30);
    expect(aim.y).toBeGreaterThan(0);
    w.player.input.press('shrapnel');
    w.tick();
    expect(w.kitEvents.some((e) => e.type === 'shrapnelCast')).toBe(true);
    expect(SIM_DT).toBeGreaterThan(0);
  });

  it('click-to-confirm: Q arms (LMB / RMB taken from the rifle), LMB casts, RMB cancels', () => {
    const w = createKitWorld({ level: 16, kit: { clickToConfirm: true } });
    learnAll(w);
    w.player.lookAt(1200, 0, 0);
    w.player.input.press('shrapnel');
    w.tick();
    expect(w.kit.shrapnelArmed).toBe(true);
    expect(w.player.input.bindings.fire).toEqual([]);
    expect(w.player.input.bindings.scope).toEqual(['KeyE']);
    w.kit.cancel();
    w.tick();
    expect(w.kit.shrapnelArmed).toBe(false);
    expect(w.player.input.bindings.fire).toEqual(['Mouse0']);
    expect(w.kitEvents.some((e) => e.type === 'shrapnelCast')).toBe(false);

    w.player.input.press('shrapnel');
    w.tick();
    w.kit.confirm();
    w.tick();
    expect(w.kitEvents.some((e) => e.type === 'shrapnelCast')).toBe(true);
    expect(w.kit.shrapnelArmed).toBe(false);
    expect(w.player.input.bindings.scope).toEqual(['Mouse2', 'KeyE']);
  });
});
