// Public API of the FPS player: createPlayer() wires input, movement, rifle, scope, viewmodel and effects.
//
//   const player = createPlayer({ map, camera, scene, events, ui, pointerLockTarget: canvas, obstacles, targets, stats });
//   startLoop({
//     update: (dt) => { player.update(dt); /* abilities read player.input.pressed(...) after this */ },
//     render: (alpha, frameDt) => { player.render(alpha, frameDt); renderer.render(scene, camera); player.renderOverlay(renderer); },
//   });
import { Vector3 } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { EYE_HEIGHT, SIM_DT, scaledRange } from '../core/config';
import { toThree } from '../core/coords';
import type { EventBus } from '../core/events';
import type { LoadedMap } from '../core/map';
import { createRng } from '../core/rng';
import { SNIPER, heroStatsAtLevel } from '../data';
import type { GameEvents, Hittable, ShotResult, Vec3 } from '../core/types';
import { PlayerController } from './controller';
import type { MoveCommand, ObstacleProvider } from './controller';
import { ShotEffects } from './effects';
import type { ImpactKind } from './effects';
import { TreeGrid, castShot, terrainNormal } from './hitbox';
import type { ShotBlocker, ShotWorld } from './hitbox';
import { Input, M_YAW } from './input';
import type { Action, Bindings, InputSettings } from './input';
import { DEG, forwardFromAngles, lerp, upFromAngles, vec3, wrapAngle } from './math';
import { DEFAULT_MAX_SPEED, SCOPED_SPEED_MULTIPLIER } from './movement';
import type { MoveParams } from './movement';
import { ScopeOverlay, ScopeState } from './scope';
import type { ScopeParams, ZoomLevel } from './scope';
import { Rifle, computeSpread } from './weapon';
import type { FiredShot, RifleParams, SpreadState } from './weapon';
import { Viewmodel } from './viewmodel';
import type { ViewmodelFrame } from './viewmodel';

export type { Action, Bindings, InputSettings } from './input';
export type { MoveCommand, Obstacle, ObstacleProvider } from './controller';
export type { ShotBlocker, ShotWorld, HitboxShape } from './hitbox';
export type { ZoomLevel } from './scope';
export { castShot, hitboxFor, TreeGrid } from './hitbox';
export { PlayerController } from './controller';
export { Input, DEFAULT_BINDINGS } from './input';
export { Rifle } from './weapon';
export { ScopeState } from './scope';

/** Gameplay stats the sim / data layer feeds in. Mutable: changes apply from the next tick / shot. */
export interface PlayerStats {
  /** Base move speed (units/s). */
  moveSpeed: number;
  /** Seconds between shots (DotA attack cooldown incl. attack speed). */
  fireInterval: number;
  /** Attack range already multiplied by RANGE_SCALE (Take Aim bonus included). */
  range: number;
}

/**
 * Level-1 Sniper from src/data (6.83d map data): 290 move speed, BAT 1.7 with 21 agility IAS (≈1.40 s between
 * shots), 550 range × RANGE_SCALE. In the real game the sim feeds live values (items, levels, Take Aim, slows).
 */
export const DEFAULT_PLAYER_STATS: Readonly<PlayerStats> = {
  moveSpeed: SNIPER.moveSpeed,
  fireInterval: heroStatsAtLevel(SNIPER, 1).attackCooldown,
  range: scaledRange(SNIPER.attackRange),
};

export type TargetProvider = () => Iterable<Hittable>;

export interface CreatePlayerOptions {
  map: LoadedMap;
  /** World camera; the player drives its position, orientation, FOV and aspect. */
  camera: PerspectiveCamera;
  /** World scene, for tracers / impacts / decals. */
  scene: Scene;
  events: EventBus<GameEvents>;
  /** DOM overlay root for the crosshair and scope. */
  ui?: HTMLElement;
  /** Element that takes pointer lock on click (the canvas). */
  pointerLockTarget?: HTMLElement;
  obstacles?: ObstacleProvider;
  targets?: TargetProvider;
  /** Building cylinders that stop shots. */
  buildings?: () => readonly ShotBlocker[];
  stats?: Partial<PlayerStats>;
  /** Spawn feet position (default: Sentinel hero_spawn / fountain). */
  spawn?: { x: number; y: number; yaw?: number };
  /** Defaults to ?test=1. */
  testMode?: boolean;
  seed?: number;
  /** Excluded from hitscan (the player's own Hittable in the sim). */
  shooterId?: number;
  bindings?: Partial<Bindings>;
  inputSettings?: Partial<InputSettings>;
  moveParams?: Partial<MoveParams>;
  scopeParams?: Partial<ScopeParams>;
  rifleParams?: Partial<Pick<RifleParams, 'spread' | 'punchPitch'>>;
  /** Max-speed multiplier while scoped (CS AWP 150/210). */
  scopedSpeedMultiplier?: number;
  /** Shared TreeGrid if the sim already built one. */
  trees?: TreeGrid;
  muzzleLight?: boolean;
}

export interface PlayerSnapshot {
  tick: number;
  simTime: number;
  position: Vec3;
  velocity: Vec3;
  eye: Vec3;
  speed: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  groundZ: number;
  zoomLevel: ZoomLevel;
  isScoped: boolean;
  weaponReady: boolean;
  cycle: number;
  shots: number;
  locked: boolean;
}

export interface PlayerTestHooks {
  /** Replaces the held actions, e.g. setKeys(['forward']) or setKeys({ forward: true }). */
  setKeys(keys: Action[] | Partial<Record<Action, boolean>>): void;
  /** Holds actions for exactly `seconds` of sim time (tick-exact, independent of headless frame rate), then releases. */
  hold(keys: Action[], seconds: number): void;
  /** True while a hold() is running. */
  readonly holding: boolean;
  /** Player state captured on the tick the last hold() released its keys. */
  readonly holdResult: PlayerSnapshot | null;
  /** Turns the view by radians (+yaw = left / CCW, +pitch = up). */
  look(yawDelta: number, pitchDelta: number): void;
  fire(): void;
  press(action: Action): void;
  readonly state: PlayerSnapshot;
}

declare global {
  interface Window {
    __player?: PlayerTestHooks;
    __lastShot?: ShotResult;
  }
}

/** Sentinel hero_spawn, else a point just outside the Sentinel fountain, facing the map centre. */
export const findSpawn = (map: LoadedMap): { x: number; y: number; yaw: number } => {
  const ents = map.data.entities;
  const spawn = ents.find((e) => e.kind === 'hero_spawn' && e.team === 'sentinel');
  if (spawn) return { x: spawn.x, y: spawn.y, yaw: spawn.facing };
  const fountain = ents.find((e) => e.kind === 'fountain' && e.team === 'sentinel');
  if (fountain) {
    // Step out of the fountain towards the map centre.
    const cx = (map.data.bounds.minX + map.data.bounds.maxX) / 2 - fountain.x;
    const cy = (map.data.bounds.minY + map.data.bounds.maxY) / 2 - fountain.y;
    const len = Math.hypot(cx, cy) || 1;
    return { x: fountain.x + (cx / len) * 250, y: fountain.y + (cy / len) * 250, yaw: Math.atan2(cy, cx) };
  }
  return { x: 0, y: 0, yaw: 0 };
};

export class SniperPlayer {
  readonly input: Input;
  readonly controller: PlayerController;
  readonly weapon: Rifle;
  readonly scope: ScopeState;
  readonly stats: PlayerStats;
  readonly trees: TreeGrid;
  readonly viewmodel: Viewmodel;
  readonly effects: ShotEffects;
  targets: TargetProvider;
  scopedSpeedMultiplier: number;
  /** Set by the sim while the hero is stunned: no movement input and no shooting (gravity still applies). */
  stunned = false;

  private readonly map: LoadedMap;
  private readonly camera: PerspectiveCamera;
  private readonly overlay: ScopeOverlay | null;
  private readonly buildings: (() => readonly ShotBlocker[]) | undefined;
  private readonly shooterId: number | undefined;
  private readonly cmd: MoveCommand = { forward: 0, side: 0, jump: false, jumpPressed: false, walk: false };
  private readonly lookDelta = { x: 0, y: 0 };
  private readonly fireAngles = { yaw: 0, pitch: 0 };
  private readonly pendingShots: FiredShot[] = [];
  private readonly unsubscribe: Array<() => void> = [];
  private smoothZ = Number.NaN;
  private lastYaw = 0;
  private lastPitch = 0;
  private viewHeight = 720;
  private readonly vmFrame: ViewmodelFrame = { frameDt: 0, speed2d: 0, onGround: true, dYaw: 0, dPitch: 0, scoped: false };
  /** Crosshair shows the unscoped (no-scope) inaccuracy. */
  private readonly spreadState: SpreadState = { speed2d: 0, onGround: true, scoped: false, baseSpeed: DEFAULT_MAX_SPEED };
  /** Test-mode hold() countdown in ticks. */
  private holdTicks = 0;
  private holdResult: PlayerSnapshot | null = null;
  private readonly feet = vec3();
  private readonly fwd = vec3();
  private readonly up = vec3();
  private readonly eyeV = vec3();
  private readonly tv = new Vector3();
  private readonly tv2 = new Vector3();

  constructor(opts: CreatePlayerOptions) {
    this.map = opts.map;
    this.camera = opts.camera;
    this.stats = { ...DEFAULT_PLAYER_STATS, ...opts.stats };
    this.targets = opts.targets ?? ((): Iterable<Hittable> => []);
    this.buildings = opts.buildings;
    this.shooterId = opts.shooterId;
    this.scopedSpeedMultiplier = opts.scopedSpeedMultiplier ?? SCOPED_SPEED_MULTIPLIER;
    const testMode = opts.testMode ?? new URLSearchParams(location.search).get('test') === '1';

    this.trees = opts.trees ?? new TreeGrid(opts.map.data.trees);
    const spawn = opts.spawn ? { yaw: 0, ...opts.spawn } : findSpawn(opts.map);
    this.controller = new PlayerController(opts.map, { x: spawn.x, y: spawn.y, yaw: spawn.yaw, obstacles: opts.obstacles, params: opts.moveParams });
    this.controller.maxSpeed = this.stats.moveSpeed;
    this.lastYaw = this.controller.yaw;
    this.scope = new ScopeState(opts.scopeParams);
    this.weapon = new Rifle(opts.events, createRng(opts.seed ?? 0x5e1f), {
      fireInterval: this.stats.fireInterval,
      range: this.stats.range,
      ...opts.rifleParams,
    });

    this.input = new Input({
      target: opts.pointerLockTarget ?? document.body,
      testMode,
      bindings: opts.bindings,
      settings: opts.inputSettings,
    });
    // Snapshot the view at the instant of the click so flick shots land where the crosshair was.
    const onPress = (a: Action): void => {
      if (a !== 'fire') return;
      this.applyLook();
      this.fireAngles.yaw = this.controller.yaw;
      this.fireAngles.pitch = this.controller.pitch;
    };
    this.input.pressListeners.add(onPress);
    this.unsubscribe.push(() => this.input.pressListeners.delete(onPress));

    this.viewmodel = new Viewmodel(this.camera.aspect);
    this.effects = new ShotEffects(opts.scene, { muzzleLight: opts.muzzleLight });
    this.overlay = opts.ui ? new ScopeOverlay(opts.ui) : null;
    this.camera.fov = this.scope.fov;
    this.camera.updateProjectionMatrix();

    if (testMode) this.installTestHooks(opts.events);
  }

  /** Fixed sim tick. Call before anything else that reads `input.pressed()` this tick. */
  update(dt: number): void {
    const { input, controller: ctl, scope, weapon, stats } = this;
    input.beginTick();
    this.applyLook();

    weapon.tick(dt);
    if (input.pressed('scope')) scope.requestToggle();
    scope.tick(dt, weapon.ready);

    ctl.maxSpeed = stats.moveSpeed;
    ctl.speedMultiplier = scope.isScoped ? this.scopedSpeedMultiplier : 1;
    const cmd = this.cmd;
    const free = !this.stunned;
    cmd.forward = free ? (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0) : 0;
    cmd.side = free ? (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0) : 0;
    cmd.jump = free && input.isDown('jump');
    cmd.jumpPressed = free && input.pressed('jump');
    cmd.walk = input.isDown('walk');
    ctl.update(cmd, dt);
    if (this.holdTicks > 0 && --this.holdTicks === 0) {
      input.setVirtual([]);
      this.holdResult = this.snapshot();
    }

    const clicked = input.pressed('fire');
    if (free && (clicked || input.isDown('fire')) && weapon.ready) {
      weapon.params.fireInterval = stats.fireInterval;
      weapon.params.range = stats.range;
      const shot = weapon.fire({
        origin: ctl.eye(this.eyeV),
        yaw: clicked ? this.fireAngles.yaw : ctl.yaw,
        pitch: clicked ? this.fireAngles.pitch : ctl.pitch,
        speed2d: ctl.horizontalSpeed,
        onGround: ctl.onGround,
        scoped: scope.isScoped,
        baseSpeed: stats.moveSpeed,
        targets: this.targets(),
        world: this.shotWorld(),
        shooterId: this.shooterId,
      });
      if (shot) {
        scope.onFire();
        if (this.pendingShots.length < 8) this.pendingShots.push(shot);
      }
    }
  }

  /** Per animation frame: mouse look, interpolated camera, viewmodel, effects and overlay. */
  render(alpha: number, frameDt: number): void {
    this.applyLook();
    const ctl = this.controller;
    const feet = ctl.interpolatedFeet(alpha, this.feet);

    // GoldSrc V_CalcRefdef stair smoothing: on step-ups the eye lags up to 18 units and catches up at 150 u/s.
    if (Number.isNaN(this.smoothZ) || !ctl.onGround || feet.z <= this.smoothZ) {
      this.smoothZ = feet.z;
    } else {
      this.smoothZ = Math.min(feet.z, this.smoothZ + frameDt * 150);
      if (feet.z - this.smoothZ > 18) this.smoothZ = feet.z - 18;
    }

    const punch = lerp(this.weapon.prevPunch, this.weapon.punch, alpha);
    const yaw = ctl.yaw;
    const pitch = ctl.pitch + punch;
    const cam = this.camera;
    toThree(feet.x, feet.y, this.smoothZ + EYE_HEIGHT, cam.position);
    const f = forwardFromAngles(yaw, pitch, this.fwd);
    cam.lookAt(this.tv.copy(cam.position).add(toThree(f.x, f.y, f.z, this.tv2)));
    const fov = this.scope.fov;
    if (Math.abs(cam.fov - fov) > 1e-6) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    const scoped = this.scope.isScoped;
    const vm = this.vmFrame;
    vm.frameDt = frameDt;
    vm.speed2d = ctl.horizontalSpeed;
    vm.onGround = ctl.onGround;
    vm.dYaw = wrapAngle(yaw - this.lastYaw);
    vm.dPitch = ctl.pitch - this.lastPitch;
    vm.scoped = scoped;
    this.viewmodel.update(vm);
    this.lastYaw = yaw;
    this.lastPitch = ctl.pitch;

    for (const shot of this.pendingShots) this.playShotEffects(shot, scoped);
    this.pendingShots.length = 0;
    this.effects.update(frameDt);

    if (this.overlay) {
      const ss = this.spreadState;
      ss.speed2d = ctl.horizontalSpeed;
      ss.onGround = ctl.onGround;
      ss.baseSpeed = this.stats.moveSpeed;
      const spread = computeSpread(ss, this.weapon.params.spread);
      const focal = this.viewHeight / 2 / Math.tan((cam.fov * DEG) / 2);
      this.overlay.update(scoped, spread * focal * 0.5, frameDt);
    }
  }

  /** Draws the first-person rifle after the world pass. */
  renderOverlay(renderer: WebGLRenderer): void {
    this.viewmodel.render(renderer);
  }

  resize(width: number, height: number): void {
    this.viewHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(width / height);
  }

  /** Crosshair trace without spread (for ability targeting: Shrapnel ground point, Assassinate lock). */
  aimTrace(maxRange = this.stats.range, targets: Iterable<Hittable> = this.targets()): ShotResult {
    const ctl = this.controller;
    const dir = forwardFromAngles(ctl.yaw, ctl.pitch, vec3());
    return castShot(ctl.eye(vec3()), dir, maxRange, targets, this.shotWorld(), this.shooterId);
  }

  snapshot(): PlayerSnapshot {
    const c = this.controller;
    return {
      tick: c.ticks,
      simTime: c.ticks * SIM_DT,
      position: { ...c.position },
      velocity: { ...c.velocity },
      eye: c.eye(vec3()),
      speed: c.horizontalSpeed,
      yaw: c.yaw,
      pitch: c.pitch,
      onGround: c.onGround,
      groundZ: c.groundZ,
      zoomLevel: this.scope.zoomLevel,
      isScoped: this.scope.isScoped,
      weaponReady: this.weapon.ready,
      cycle: this.weapon.cycle,
      shots: this.weapon.shots,
      locked: this.input.locked,
    };
  }

  dispose(): void {
    for (const fn of this.unsubscribe) fn();
    this.input.dispose();
    this.overlay?.dispose();
    this.effects.dispose();
    this.viewmodel.dispose();
    if (window.__player) delete window.__player;
  }

  // --- internals ------------------------------------------------------------------------------

  private shotWorld(): ShotWorld {
    return { map: this.map, trees: this.trees, buildings: this.buildings?.() };
  }

  private applyLook(): void {
    this.input.consumeLook(this.lookDelta);
    const { x, y } = this.lookDelta;
    if (x === 0 && y === 0) return;
    const s = this.input.settings;
    const k = s.sensitivity * M_YAW * this.scope.sensitivityScale;
    this.controller.addLook(-x * k, -y * k * (s.invertY ? -1 : 1));
  }

  private playShotEffects(shot: FiredShot, scoped: boolean): void {
    const ctl = this.controller;
    const cam = this.camera;
    this.viewmodel.onFire(this.weapon.lastInterval);

    // Tracer starts at the muzzle as drawn on screen (viewmodel NDC unprojected ~40 units out), or just under
    // the eye when the rifle is hidden by the scope.
    const start = this.tv;
    if (scoped) {
      const e = shot.origin;
      const u = upFromAngles(ctl.yaw, ctl.pitch, this.up);
      toThree(e.x + shot.direction.x * 24 - u.x * 5, e.y + shot.direction.y * 24 - u.y * 5, e.z + shot.direction.z * 24 - u.z * 5, start);
    } else {
      this.viewmodel.muzzleNdc(start);
      start.set(start.x, start.y, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(40).add(cam.position);
    }
    const r = shot.result;
    this.effects.muzzleFlash({ x: shot.origin.x + shot.direction.x * 40, y: shot.origin.y + shot.direction.y * 40, z: shot.origin.z + shot.direction.z * 40 });
    this.effects.tracer(start, r.point);

    let kind: ImpactKind | null = null;
    let normal: Vec3 | null = null;
    if (r.targetId !== null) kind = r.part === 'head' ? 'head' : 'body';
    else if (r.blockedBy === 'terrain') {
      kind = 'terrain';
      normal = terrainNormal(this.map, r.point.x, r.point.y, vec3());
    } else if (r.blockedBy === 'tree') kind = 'tree';
    else if (r.blockedBy === 'building') kind = 'building';
    if (kind) this.effects.impact(r.point, normal, kind, shot.direction);
  }

  private installTestHooks(events: EventBus<GameEvents>): void {
    const off = events.on('player:shot', (p) => {
      window.__lastShot = p.result;
    });
    this.unsubscribe.push(off);
    const self = this;
    window.__player = {
      setKeys(keys) {
        const list = Array.isArray(keys) ? keys : (Object.keys(keys) as Action[]).filter((k) => keys[k]);
        self.input.setVirtual(list);
      },
      hold(keys, seconds) {
        self.input.setVirtual(keys);
        self.holdTicks = Math.max(1, Math.round(seconds / SIM_DT));
        self.holdResult = null;
      },
      get holding() {
        return self.holdTicks > 0;
      },
      get holdResult() {
        return self.holdResult;
      },
      look(yawDelta, pitchDelta) {
        self.controller.addLook(yawDelta, pitchDelta);
      },
      fire() {
        self.input.press('fire');
      },
      press(action) {
        self.input.press(action);
      },
      get state() {
        return self.snapshot();
      },
    };
  }
}

export const createPlayer = (opts: CreatePlayerOptions): SniperPlayer => new SniperPlayer(opts);
