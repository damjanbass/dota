import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { EventBus } from '../../src/core/events';
import { createRng } from '../../src/core/rng';
import type { GameEvents, Hittable } from '../../src/core/types';
import { headCenterZ, hitboxFor } from '../../src/player/hitbox';
import { DEG } from '../../src/player/math';
import { CS_FOV, ScopeState, csFovToVertical } from '../../src/player/scope';
import { AWP_SPREAD, Rifle, computeSpread, decayPunch } from '../../src/player/weapon';
import type { FireRequest } from '../../src/player/weapon';

const target = (): Hittable => ({
  id: 5,
  team: 'scourge',
  position: { x: 500, y: 0, z: 0 },
  ...hitboxFor({ collisionRadius: 24, height: 96 }),
  alive: true,
});

const request = (t: Hittable, over: Partial<FireRequest> = {}): FireRequest => {
  const eye = { x: 0, y: 0, z: 64 };
  return {
    origin: eye,
    yaw: 0,
    pitch: Math.atan2(headCenterZ(t) - eye.z, 500),
    speed2d: 0,
    onGround: true,
    scoped: true,
    baseSpeed: 290,
    targets: [t],
    world: {},
    ...over,
  };
};

describe('AWP spread model', () => {
  const base = { speed2d: 0, onGround: true, scoped: true, baseSpeed: 290 };

  it('scoped and still is near-perfect; unscoped adds the no-scope penalty', () => {
    expect(computeSpread(base)).toBe(AWP_SPREAD.still);
    expect(computeSpread({ ...base, scoped: false })).toBeCloseTo(AWP_SPREAD.still + AWP_SPREAD.unscopedPenalty, 9);
  });

  it('gets worse when moving, running and airborne', () => {
    const still = computeSpread(base);
    const walking = computeSpread({ ...base, speed2d: 290 * 0.52 }); // shift-walk stays under the run threshold
    const running = computeSpread({ ...base, speed2d: 290 });
    const air = computeSpread({ ...base, onGround: false });
    expect(walking).toBe(AWP_SPREAD.moving);
    expect(running).toBe(AWP_SPREAD.running);
    expect(still).toBeLessThan(walking);
    expect(walking).toBeLessThan(running);
    expect(running).toBeLessThan(air);
  });

  it('scoped + still lands every shot in a 500-unit head; running no-scopes mostly miss it', () => {
    const t = target();
    let heads = 0;
    let headsRunning = 0;
    const events = new EventBus<GameEvents>();
    for (let i = 0; i < 100; i++) {
      const rifle = new Rifle(events, createRng(i), { fireInterval: 1, range: 3000 });
      if (rifle.fire(request(t))!.result.part === 'head') heads++;
      const rifle2 = new Rifle(events, createRng(1000 + i), { fireInterval: 1, range: 3000 });
      if (rifle2.fire(request(t, { scoped: false, speed2d: 290 }))!.result.part === 'head') headsRunning++;
    }
    expect(heads).toBe(100);
    expect(headsRunning).toBeLessThan(25);
  });
});

describe('Rifle', () => {
  it('fires once per interval (bolt-action cooldown) and reports cycle progress', () => {
    const rifle = new Rifle(new EventBus<GameEvents>(), createRng(1), { fireInterval: 1.7, range: 3000 });
    const t = target();
    expect(rifle.fire(request(t))).not.toBeNull();
    expect(rifle.ready).toBe(false);
    expect(rifle.fire(request(t))).toBeNull();
    let n = 0;
    while (!rifle.ready) {
      rifle.tick(SIM_DT);
      n++;
    }
    expect(n * SIM_DT).toBeCloseTo(1.7, 1);
    expect(rifle.cycle).toBe(1);
    expect(rifle.fire(request(t))).not.toBeNull();
    expect(rifle.shots).toBe(2);
  });

  it("emits 'player:shot' with the ShotResult and applies no damage itself", () => {
    const events = new EventBus<GameEvents>();
    const seen: GameEvents['player:shot'][] = [];
    events.on('player:shot', (p) => seen.push(p));
    let damaged = 0;
    events.on('unit:damaged', () => damaged++);
    const t = target();
    const rifle = new Rifle(events, createRng(3), { fireInterval: 1, range: 3000 });
    rifle.fire(request(t));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.result).toMatchObject({ targetId: 5, part: 'head' });
    expect(Math.hypot(seen[0]!.direction.x, seen[0]!.direction.y, seen[0]!.direction.z)).toBeCloseTo(1, 9);
    expect(damaged).toBe(0);
    expect(t.alive).toBe(true);
  });

  it('uses the range parameter', () => {
    const rifle = new Rifle(new EventBus<GameEvents>(), createRng(3), { fireInterval: 1, range: 400 });
    expect(rifle.fire(request(target()))!.result).toMatchObject({ targetId: null, blockedBy: 'range', distance: 400 });
  });

  it('kicks the view up 2° and the punch decays CS-style within ~0.2 s', () => {
    const rifle = new Rifle(new EventBus<GameEvents>(), createRng(3), { fireInterval: 1, range: 3000 });
    rifle.fire(request(target()));
    expect(rifle.punch).toBeCloseTo(2 * DEG, 9);
    let t = 0;
    while (rifle.punch > 0) {
      rifle.tick(SIM_DT);
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThan(0.3);
    expect(decayPunch(-1 * DEG, 0.01)).toBeLessThan(0);
  });
});

describe('ScopeState (AWP)', () => {
  it('cycles none → zoom 1 → zoom 2 → none with the CS toggle delay', () => {
    const s = new ScopeState();
    expect(s.zoomLevel).toBe(0);
    s.requestToggle();
    expect(s.zoomLevel).toBe(1);
    expect(s.isScoped).toBe(true);
    s.requestToggle(); // buffered until 0.3 s have passed
    expect(s.zoomLevel).toBe(1);
    for (let i = 0; i < 10; i++) s.tick(SIM_DT, true);
    expect(s.zoomLevel).toBe(2);
    for (let i = 0; i < 10; i++) s.tick(SIM_DT, true);
    s.requestToggle();
    expect(s.zoomLevel).toBe(0);
    expect(s.isScoped).toBe(false);
  });

  it('maps CS FOVs (4:3 horizontal) to vertical FOV and scales sensitivity with zoom', () => {
    expect(csFovToVertical(90)).toBeCloseTo(73.74, 2);
    const s = new ScopeState();
    expect(s.fov).toBeCloseTo(73.74, 2);
    expect(s.sensitivityScale).toBe(1);
    s.requestToggle();
    expect(s.fov).toBeCloseTo(csFovToVertical(CS_FOV.zoom1), 9);
    expect(s.sensitivityScale).toBeCloseTo((40 / 90) * 1.2, 9);
    for (let i = 0; i < 10; i++) s.tick(SIM_DT, true);
    s.requestToggle();
    expect(s.fov).toBeLessThan(10);
    expect(s.sensitivityScale).toBeCloseTo((10 / 90) * 1.2, 9);
  });

  it('drops the scope on fire and restores it when the bolt is closed', () => {
    const s = new ScopeState();
    s.requestToggle();
    s.onFire();
    expect(s.zoomLevel).toBe(0);
    s.tick(SIM_DT, false);
    expect(s.zoomLevel).toBe(0);
    s.tick(SIM_DT, true);
    expect(s.zoomLevel).toBe(1);
  });

  it('pressing scope during the bolt cycle cancels the automatic re-zoom', () => {
    const s = new ScopeState();
    s.requestToggle();
    s.onFire();
    s.requestToggle();
    s.tick(SIM_DT, true);
    expect(s.zoomLevel).toBe(0);
  });
});
