import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_RADIUS, SIM_DT } from '../../src/core/config';
import { PathFlag, entitiesOfKind, groundHeightAt } from '../../src/core/map';
import { createMockMap } from '../../src/core/mockMap';
import { PlayerController } from '../../src/player/controller';
import type { MoveCommand, Obstacle } from '../../src/player/controller';
import { createTestMap } from '../../src/player/testing';

const cmd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ forward: 0, side: 0, jump: false, jumpPressed: false, walk: false, ...over });
const ticks = (c: PlayerController, n: number, over: Partial<MoveCommand> = {}): void => {
  for (let i = 0; i < n; i++) c.update(cmd(over), SIM_DT);
};

describe('PlayerController on open ground', () => {
  it('holding W for 1 s covers ~245 units (GoldSrc accel ramp to 290)', () => {
    const c = new PlayerController(createTestMap(), { x: -1500, y: 0, yaw: 0 });
    ticks(c, 30, { forward: 1 });
    expect(c.position.x + 1500).toBeGreaterThan(220);
    expect(c.position.x + 1500).toBeLessThan(270);
    expect(c.horizontalSpeed).toBeCloseTo(290, 1);
    expect(Math.abs(c.position.y)).toBeLessThan(1e-6);
  });

  it('moves along the view yaw (WC3: 0 = east, CCW) and strafes right with D', () => {
    const c = new PlayerController(createTestMap(), { x: 0, y: 0, yaw: Math.PI / 2 }); // facing north
    ticks(c, 15, { forward: 1 });
    expect(c.position.y).toBeGreaterThan(50);
    expect(Math.abs(c.position.x)).toBeLessThan(1e-6);
    const d = new PlayerController(createTestMap(), { x: 0, y: 0, yaw: Math.PI / 2 });
    ticks(d, 15, { side: 1 });
    expect(d.position.x).toBeGreaterThan(50); // right of north = east
  });

  it('friction brings the player to a stop after releasing keys', () => {
    const c = new PlayerController(createTestMap(), { x: -1500, y: 0 });
    ticks(c, 30, { forward: 1 });
    ticks(c, 20);
    expect(c.horizontalSpeed).toBe(0);
  });

  it('keeps the feet on the heightfield (absolute heights) and exposes eye height', () => {
    const map = createTestMap({ height: (x) => 1024 + x * 0.25 });
    const c = new PlayerController(map, { x: -1000, y: 0, yaw: 0 });
    expect(c.position.z).toBeCloseTo(groundHeightAt(map, -1000, 0), 4);
    ticks(c, 30, { forward: 1 });
    expect(c.onGround).toBe(true);
    expect(c.position.z).toBeCloseTo(groundHeightAt(map, c.position.x, c.position.y), 4);
    expect(c.eye().z).toBeCloseTo(c.position.z + EYE_HEIGHT, 6);
    // Walking back downhill stays grounded (no "flying" off a slope).
    c.setAngles(Math.PI, 0);
    for (let i = 0; i < 30; i++) {
      c.update(cmd({ forward: 1 }), SIM_DT);
      expect(c.onGround).toBe(true);
    }
  });
});

describe('PlayerController collision', () => {
  const wallX = 256; // pathing cells east of x = 256 are unwalkable (a cliff wall)
  const wallMap = (): ReturnType<typeof createTestMap> =>
    createTestMap({ pathing: (x) => (x > wallX ? PathFlag.Unwalkable : 0) });

  it('blocks walking into unwalkable cells and stops flush against them', () => {
    const c = new PlayerController(wallMap(), { x: 0, y: 0, yaw: 0 });
    ticks(c, 60, { forward: 1 });
    expect(c.position.x).toBeLessThanOrEqual(wallX - PLAYER_RADIUS);
    expect(c.position.x).toBeGreaterThan(wallX - PLAYER_RADIUS - 0.1);
    expect(c.velocity.x).toBe(0);
  });

  it('slides along a blocked wall when moving diagonally into it (axis-separated)', () => {
    const c = new PlayerController(wallMap(), { x: 200, y: 0, yaw: Math.PI / 4 }); // north-east
    ticks(c, 45, { forward: 1 });
    expect(c.position.x).toBeLessThanOrEqual(wallX - PLAYER_RADIUS);
    expect(c.position.y).toBeGreaterThan(150);
  });

  it('trees in the pathing grid block too', () => {
    const map = createTestMap({ pathing: (x, y) => (Math.hypot(x - 200, y) < 64 ? PathFlag.Tree : 0) });
    const c = new PlayerController(map, { x: 0, y: 0, yaw: 0 });
    ticks(c, 60, { forward: 1 });
    expect(c.position.x).toBeLessThan(200 - 64 - PLAYER_RADIUS + 32);
  });

  it('pushes out of obstacle cylinders and slides around them', () => {
    const obstacles: Obstacle[] = [{ x: 300, y: 0, radius: 60 }];
    const provider = { obstaclesNear: (): Obstacle[] => obstacles };
    const c = new PlayerController(createTestMap(), { x: 0, y: 0, yaw: 0, obstacles: provider });
    ticks(c, 60, { forward: 1 });
    expect(Math.hypot(c.position.x - 300, c.position.y)).toBeGreaterThanOrEqual(60 + PLAYER_RADIUS - 1e-3);
    // Off-centre: the player is deflected around the cylinder and continues east.
    const d = new PlayerController(createTestMap(), { x: 0, y: 40, yaw: 0, obstacles: provider });
    ticks(d, 90, { forward: 1 });
    expect(d.position.x).toBeGreaterThan(300);
    expect(d.position.y).toBeGreaterThan(40);
  });

  it('a player spawned inside a blocked cell can walk out', () => {
    const map = createTestMap({ pathing: (x) => (x < 64 ? PathFlag.Unwalkable : 0) });
    const c = new PlayerController(map, { x: 0, y: 0, yaw: 0 });
    ticks(c, 30, { forward: 1 });
    expect(c.position.x).toBeGreaterThan(100);
  });

  it('cannot leave the pathing grid', () => {
    const c = new PlayerController(createTestMap({ half: 512 }), { x: 0, y: 0, yaw: 0 });
    ticks(c, 120, { forward: 1 });
    expect(c.position.x).toBeLessThanOrEqual(512 - 32 - PLAYER_RADIUS);
  });
});

describe('PlayerController on the mock DotA map', () => {
  it('walks from the Sentinel hero spawn without falling through or sticking', () => {
    const map = createMockMap();
    const spawn = entitiesOfKind(map, 'hero_spawn', 'sentinel')[0]!;
    const c = new PlayerController(map, { x: spawn.x, y: spawn.y, yaw: Math.PI / 4 });
    ticks(c, 60, { forward: 1 });
    expect(Math.hypot(c.position.x - spawn.x, c.position.y - spawn.y)).toBeGreaterThan(400);
    expect(c.position.z).toBeCloseTo(groundHeightAt(map, c.position.x, c.position.y), 3);
  });
});
