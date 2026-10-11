// Test fixtures for the kit: a stub FPS player (real crosshair trace via castShot against the fake sim's units) and a
// small world builder. Used by tests/unit/kit*.test.ts; not used at runtime.
import { EYE_HEIGHT, SIM_DT } from '../../../core/config';
import { EventBus } from '../../../core/events';
import { groundHeightAt } from '../../../core/map';
import type { LoadedMap } from '../../../core/map';
import type { GameEvents, Hittable, ShotResult, Vec3 } from '../../../core/types';
import { castShot, hitboxFor } from '../../hitbox';
import { DEFAULT_BINDINGS } from '../../input';
import type { Action, Bindings } from '../../input';
import { forwardFromAngles } from '../../math';
import { createTestMap } from '../../testing';
import { KitLogic } from '../kitLogic';
import type { KitEvent, KitOptions, KitPlayer } from '../kitLogic';
import { FakeSim } from './fakeSim';

export class StubInput {
  readonly bindings: Bindings = structuredClone(DEFAULT_BINDINGS) as Bindings;
  readonly testMode = true;
  readonly active = true;
  readonly held = new Set<Action>();
  private queued = new Set<Action>();
  private current = new Set<Action>();

  pressed(a: Action): boolean {
    return this.current.has(a);
  }

  isDown(a: Action): boolean {
    return this.held.has(a);
  }

  /** Press edge seen on the next tick. */
  press(a: Action): void {
    this.queued.add(a);
  }

  beginTick(): void {
    this.current = this.queued;
    this.queued = new Set();
  }

  rebind(action: Action, codes: string[]): void {
    this.bindings[action] = [...codes];
  }

  requestLock(): void {}
}

export class StubPlayer implements KitPlayer {
  readonly input = new StubInput();
  readonly scope = { isScoped: false, resumeLevel: 0 };
  readonly stats = { range: 1100 };
  readonly controller: KitPlayer['controller'] & { teleports: number };

  constructor(
    private readonly sim: FakeSim,
    x: number,
    y: number,
  ) {
    const map = sim.map;
    this.controller = {
      position: { x, y, z: groundHeightAt(map, x, y) },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      teleports: 0,
      teleport(tx: number, ty: number) {
        this.position.x = tx;
        this.position.y = ty;
        this.position.z = groundHeightAt(map, tx, ty);
        this.teleports++;
      },
    };
  }

  eye(): Vec3 {
    const p = this.controller.position;
    return { x: p.x, y: p.y, z: p.z + EYE_HEIGHT };
  }

  hittables(): Hittable[] {
    return this.sim
      .units()
      .filter((u) => u.kind !== 'tower' && u.kind !== 'fountain' && !u.kind.startsWith('barracks') && u.kind !== 'ancient')
      .map((u) => ({ id: u.id, team: u.team, position: u.position, alive: u.alive, ...hitboxFor({ collisionRadius: u.def.collisionRadius, height: u.def.height }) }));
  }

  aimTrace(maxRange = this.stats.range): ShotResult {
    const dir = forwardFromAngles(this.controller.yaw, this.controller.pitch);
    return castShot(this.eye(), dir, maxRange, this.hittables(), { map: this.sim.map }, this.sim.player().id);
  }

  /** Points the crosshair at a world point. */
  lookAt(x: number, y: number, z: number): void {
    const e = this.eye();
    this.controller.yaw = Math.atan2(y - e.y, x - e.x);
    this.controller.pitch = Math.atan2(z - e.z, Math.hypot(x - e.x, y - e.y));
  }

  /** Points the crosshair at a unit's chest. */
  lookAtUnit(id: number): void {
    const u = this.sim.get(id)!;
    this.lookAt(u.position.x, u.position.y, u.position.z + u.def.height * 0.5);
  }
}

export interface KitWorld {
  map: LoadedMap;
  sim: FakeSim;
  player: StubPlayer;
  kit: KitLogic;
  heroId: number;
  kitEvents: KitEvent[];
  gameEvents: Array<{ type: keyof GameEvents; payload: unknown }>;
  /** Runs n fixed ticks in the Lead's order: input → kit → position sync → sim. */
  tick(n?: number): void;
  seconds(s: number): void;
}

export const createKitWorld = (opts: { level?: number; kit?: KitOptions; seed?: number; map?: LoadedMap } = {}): KitWorld => {
  const map = opts.map ?? createTestMap({ half: 4096 });
  const events = new EventBus<GameEvents>();
  const sim = new FakeSim({ map, seed: opts.seed ?? 7, events });
  const hero = sim.spawnHero('sniper', 'sentinel', 0, 0, { level: opts.level ?? 16, isPlayer: true });
  const player = new StubPlayer(sim, 0, 0);
  const kit = new KitLogic(sim, player, events, opts.kit);
  const kitEvents: KitEvent[] = [];
  kit.on((e) => kitEvents.push(e));
  const gameEvents: KitWorld['gameEvents'] = [];
  for (const type of ['unit:damaged', 'ability:cast', 'player:ability', 'projectile:launched', 'projectile:hit'] as const) {
    events.on(type, (payload) => gameEvents.push({ type, payload }));
  }
  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      player.input.beginTick();
      kit.update(SIM_DT);
      sim.setUnitPosition(hero.id, player.controller.position, player.controller.yaw);
      sim.step(SIM_DT);
    }
  };
  return { map, sim, player, kit, heroId: hero.id, kitEvents, gameEvents, tick, seconds: (s) => tick(Math.round(s / SIM_DT)) };
};

/** Learns every Sniper skill to its max allowed by the hero's level. */
export const learnAll = (w: KitWorld): void => {
  for (const id of ['sniper_shrapnel', 'sniper_headshot', 'sniper_take_aim', 'sniper_assassinate']) {
    while (w.sim.learnAbility(w.heroId, id));
  }
};
