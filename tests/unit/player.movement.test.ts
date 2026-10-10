import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { PlayerController } from '../../src/player/controller';
import type { MoveCommand } from '../../src/player/controller';
import {
  DEFAULT_MAX_SPEED,
  MOVE_DEFAULTS,
  SCOPED_SPEED_MULTIPLIER,
  accelerate,
  airAccelerate,
  applyFriction,
  staminaFactor,
  wishDirection,
} from '../../src/player/movement';
import { createTestMap } from '../../src/player/testing';

const cmd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ forward: 0, side: 0, jump: false, jumpPressed: false, walk: false, ...over });
const speed = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

describe('GoldSrc friction (sv_friction 4, sv_stopspeed 100)', () => {
  it('removes speed · friction · dt above stopspeed', () => {
    const v = { x: 300, y: 0 };
    applyFriction(v, 0.01);
    expect(v.x).toBeCloseTo(300 - 300 * 4 * 0.01, 6);
  });

  it('uses stopspeed as the control speed when slow', () => {
    const v = { x: 30, y: 40 }; // speed 50 < 100
    applyFriction(v, 0.01);
    expect(speed(v)).toBeCloseTo(50 - 100 * 4 * 0.01, 6);
    expect(v.x / v.y).toBeCloseTo(30 / 40, 6); // direction kept
  });

  it('never reverses direction and zeroes tiny speeds', () => {
    const v = { x: 20, y: 0 };
    applyFriction(v, 1);
    expect(v.x).toBe(0);
    const tiny = { x: 0.05, y: 0 };
    applyFriction(tiny, 0.01);
    expect(tiny.x).toBe(0);
  });

  it('stops a 290 u/s runner in well under a second', () => {
    const v = { x: 290, y: 0 };
    let t = 0;
    while (v.x > 0 && t < 2) {
      applyFriction(v, 0.01);
      t += 0.01;
    }
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.6);
  });
});

describe('GoldSrc accelerate (sv_accelerate 5)', () => {
  it('adds accel · dt · wishspeed along the wish direction', () => {
    const v = { x: 0, y: 0 };
    accelerate(v, 1, 0, 290, 5, 0.01);
    expect(v.x).toBeCloseTo(14.5, 6);
    expect(v.y).toBe(0);
  });

  it('caps at wishspeed and never accelerates past it', () => {
    const v = { x: 285, y: 0 };
    accelerate(v, 1, 0, 290, 5, 0.01);
    expect(v.x).toBeCloseTo(290, 6);
    const fast = { x: 400, y: 0 };
    accelerate(fast, 1, 0, 290, 5, 0.01);
    expect(fast.x).toBe(400);
  });

  it('accelerate beats friction, so ground speed settles exactly at max speed', () => {
    const v = { x: 0, y: 0 };
    for (let i = 0; i < 300; i++) {
      applyFriction(v, 0.01);
      accelerate(v, 1, 0, 290, 5, 0.01);
    }
    expect(v.x).toBeCloseTo(290, 3);
  });

  it('normalises diagonal input (no faster diagonals)', () => {
    const out = { x: 0, y: 0 };
    expect(wishDirection(1, 1, 0, out)).toBe(1);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 9);
    // yaw 0 = east: forward = +x, right = -y
    wishDirection(1, 0, 0, out);
    expect(out.x).toBeCloseTo(1);
    wishDirection(0, 1, 0, out);
    expect(out.y).toBeCloseTo(-1);
  });
});

describe('GoldSrc air acceleration and air-strafing', () => {
  it('cannot add speed straight ahead in the air (30 u/s cap)', () => {
    const v = { x: 300, y: 0 };
    airAccelerate(v, 1, 0, 290, 10, 0.01);
    expect(v.x).toBe(300);
  });

  it('adds up to the cap perpendicular to velocity, which increases total speed', () => {
    const v = { x: 300, y: 0 };
    airAccelerate(v, 0, 1, 290, 10, 0.01);
    expect(v.y).toBeCloseTo(Math.min(30, 10 * 290 * 0.01), 6);
    expect(speed(v)).toBeGreaterThan(300);
  });

  it('strafing with the wish direction kept perpendicular gains a lot of speed', () => {
    const v = { x: 290, y: 0 };
    for (let i = 0; i < 70; i++) {
      // wish = velocity rotated 90° (what strafe key + mouse turn produces)
      const s = speed(v);
      airAccelerate(v, -v.y / s, v.x / s, 290, 10, 0.01);
    }
    expect(speed(v)).toBeGreaterThan(350);
  });

  it('controller: jump + hold strafe key while turning the mouse gains speed over a straight jump', () => {
    const run = (strafe: boolean): number => {
      const map = createTestMap();
      const c = new PlayerController(map, { x: -1500, y: 0, yaw: 0 });
      for (let i = 0; i < 30; i++) c.update(cmd({ forward: 1 }), SIM_DT);
      c.update(cmd({ forward: 1, jump: true, jumpPressed: true }), SIM_DT);
      let airSpeed = c.horizontalSpeed;
      while (!c.onGround) {
        airSpeed = c.horizontalSpeed;
        if (strafe) c.addLook(-7 * SIM_DT, 0); // turn right ~400°/s…
        c.update(cmd({ side: strafe ? 1 : 0, jump: true }), SIM_DT); // …holding D
      }
      return airSpeed; // just before touchdown (landing friction + stamina eat it afterwards)
    };
    const straight = run(false);
    const strafed = run(true);
    expect(straight).toBeLessThanOrEqual(DEFAULT_MAX_SPEED + 0.01);
    expect(strafed).toBeGreaterThan(DEFAULT_MAX_SPEED + 15);
  });
});

describe('gravity, jump and CS 1.6 stamina', () => {
  it('jump velocity ≈ 268 gives a 45-unit apex and ~0.67 s airtime under gravity 800', () => {
    expect(MOVE_DEFAULTS.jumpVelocity).toBeCloseTo(268.33, 1);
    const map = createTestMap();
    const c = new PlayerController(map, { x: 0, y: 0 });
    c.update(cmd({ jump: true, jumpPressed: true }), SIM_DT);
    let apex = 0;
    let ticks = 1;
    while (!c.onGround && ticks < 100) {
      apex = Math.max(apex, c.position.z);
      c.update(cmd({ jump: true }), SIM_DT);
      ticks++;
    }
    expect(apex).toBeGreaterThan(44);
    expect(apex).toBeLessThanOrEqual(45.01);
    expect(ticks * SIM_DT).toBeGreaterThan(0.6);
    expect(ticks * SIM_DT).toBeLessThan(0.75);
  });

  it('holding jump does not auto-bunnyhop; a fresh press is needed', () => {
    const map = createTestMap();
    const c = new PlayerController(map, { x: 0, y: 0 });
    c.update(cmd({ jump: true, jumpPressed: true }), SIM_DT);
    while (!c.onGround) c.update(cmd({ jump: true }), SIM_DT);
    for (let i = 0; i < 10; i++) c.update(cmd({ jump: true }), SIM_DT);
    expect(c.onGround).toBe(true);
    expect(c.position.z).toBe(0);
  });

  it('a jump right after landing is lower (stamina), as in CS 1.6', () => {
    expect(staminaFactor(MOVE_DEFAULTS.jumpStaminaMs)).toBeCloseTo(0.75, 3);
    const map = createTestMap();
    const c = new PlayerController(map, { x: 0, y: 0 });
    const jumpApex = (): number => {
      c.update(cmd({ jump: true, jumpPressed: true }), SIM_DT);
      let apex = 0;
      while (!c.onGround) {
        apex = Math.max(apex, c.position.z);
        c.update(cmd(), SIM_DT);
      }
      return apex;
    };
    const first = jumpApex();
    const second = jumpApex();
    expect(second).toBeLessThan(first * 0.95);
  });
});

describe('max speed parameters', () => {
  const settle = (over: Partial<MoveCommand>, mult = 1): number => {
    const map = createTestMap();
    const c = new PlayerController(map, { x: -1500, y: 0 });
    c.speedMultiplier = mult;
    for (let i = 0; i < 60; i++) c.update(cmd({ forward: 1, ...over }), SIM_DT);
    return c.horizontalSpeed;
  };

  it('runs at the max-speed parameter (290 default)', () => {
    expect(settle({})).toBeCloseTo(290, 1);
  });

  it('shift-walk is 0.52× max speed', () => {
    expect(settle({ walk: true })).toBeCloseTo(290 * 0.52, 1);
  });

  it('scoped speed comes from the multiplier parameter', () => {
    expect(settle({}, SCOPED_SPEED_MULTIPLIER)).toBeCloseTo(290 * (150 / 210), 1);
  });

  it('respects a changed max speed (e.g. boots)', () => {
    const map = createTestMap();
    const c = new PlayerController(map, { x: -1500, y: 0 });
    c.maxSpeed = 340;
    for (let i = 0; i < 60; i++) c.update(cmd({ forward: 1 }), SIM_DT);
    expect(c.horizontalSpeed).toBeCloseTo(340, 1);
  });
});
