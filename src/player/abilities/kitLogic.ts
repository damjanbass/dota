// FPS-side ability logic, free of DOM and three.js so it runs in unit tests: reads the player's input / crosshair,
// drives Take Aim from the scope, aims and casts Shrapnel / Assassinate / Town Portal through the sim, levels skills.
// The kit view (kit.ts) renders what this exposes.
import { scaledRange } from '../../core/config';
import type { EventBus } from '../../core/events';
import { groundHeightAt } from '../../core/map';
import type { SimApi, UnitState } from '../../core/sim';
import type { GameEvents, Hittable, ShotResult, Vec2, Vec3 } from '../../core/types';
import { ABILITIES, SNIPER_ASSASSINATE, SNIPER_SHRAPNEL, levelValue } from '../../data';
import type { Action, Bindings } from '../input';
import { AssassinateAim } from './assassinate';
import type { AimStatus } from './assassinate';
import { castBlockReason } from './castCheck';
import { ASSASSINATE, HEADSHOT, SHRAPNEL, TAKE_AIM, TOWN_PORTAL, hasBuffFlag, skillLevel } from './ids';
import { MouseGate } from './mouseGate';
import { registerSniperAbilities } from './register';
import type { SniperSystems } from './systems';
import { applyTakeAim } from './takeAim';
import { cancelPortal } from './townPortal';
import type { PortalChannel } from './townPortal';

/** The slice of SniperPlayer the kit uses (structural, so tests can pass a stub). */
export interface KitPlayer {
  readonly input: {
    pressed(action: Action): boolean;
    isDown(action: Action): boolean;
    readonly bindings: Bindings;
    rebind(action: Action, codes: string[]): void;
    readonly testMode: boolean;
    readonly active: boolean;
    requestLock(): void;
  };
  readonly scope: { readonly isScoped: boolean; readonly resumeLevel: number };
  readonly stats: { range: number };
  readonly controller: {
    readonly position: Vec3;
    readonly velocity: Vec3;
    yaw: number;
    pitch: number;
    teleport(x: number, y: number): void;
  };
  aimTrace(maxRange?: number, targets?: Iterable<Hittable>): ShotResult;
}

export interface KitOptions {
  /** Q shows the preview, LMB confirms, RMB cancels (default: quick-cast on Q press). */
  clickToConfirm?: boolean;
  /** Faint AoE ring under the crosshair whenever Shrapnel is castable and you're unscoped (default true). */
  showIdlePreview?: boolean;
  /** Seconds the crosshair may slip off the Assassinate target before the lock resets (default 0.1). */
  aimGrace?: number;
  /** Also emit 'ability:cast' from the kit (only if the sim doesn't; default false). 'player:ability' is always emitted. */
  emitAbilityCast?: boolean;
  /** Player-facing toasts for refused casts (default true). */
  toasts?: boolean;
}

export const DEFAULT_KIT_OPTIONS: Readonly<Required<KitOptions>> = {
  clickToConfirm: false,
  showIdlePreview: true,
  aimGrace: 0.1,
  emitAbilityCast: false,
  toasts: true,
};

export type KitEvent =
  | { type: 'message'; text: string; tone: 'error' | 'info' }
  | { type: 'shrapnelCast'; x: number; y: number }
  | { type: 'assassinateFired'; targetId: number }
  | { type: 'tpOverlay'; open: boolean }
  | { type: 'tpStarted' }
  | { type: 'tpCancelled'; reason: string }
  | { type: 'tpArrived'; x: number; y: number };

export interface ShrapnelAim {
  x: number;
  y: number;
  z: number;
  /** True when the crosshair didn't hit the ground in range (target clamped to max range along the view). */
  clamped: boolean;
}

const LEVEL_KEYS: ReadonlyArray<readonly [Action, string]> = [
  ['levelShrapnel', SHRAPNEL],
  ['levelTakeAim', TAKE_AIM],
  ['levelAssassinate', ASSASSINATE],
  ['levelHeadshot', HEADSHOT],
];
const MOVE_ACTIONS: readonly Action[] = ['forward', 'back', 'left', 'right'];
/** Keeps point / unit casts inside the sim's range check despite the one-tick lag of the synced hero position. */
const RANGE_MARGIN = 24;

export class KitLogic {
  readonly options: Required<KitOptions>;
  readonly systems: SniperSystems;
  readonly aim = new AssassinateAim();
  shrapnelArmed = false;
  tpOverlayOpen = false;
  aimStatus: AimStatus = 'idle';

  private readonly gate: MouseGate;
  private readonly listeners = new Set<(e: KitEvent) => void>();
  private handledPortalSeq = 0;
  private clickLeft = false;
  private clickRight = false;
  private pendingTp: Vec2 | null = null;

  constructor(
    readonly sim: SimApi,
    readonly player: KitPlayer,
    private readonly events: EventBus<GameEvents> | null,
    options: KitOptions = {},
  ) {
    this.options = { ...DEFAULT_KIT_OPTIONS, ...options };
    this.systems = registerSniperAbilities(sim);
    this.gate = new MouseGate(player.input);
  }

  on(fn: (e: KitEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fixed tick. Call right after player.update(dt) (it reads this tick's input presses). */
  update(dt: number): void {
    const sim = this.sim;
    const hero = sim.player();
    const id = hero.id;
    const input = this.player.input;
    const now = sim.time;
    this.systems.process(sim);

    // E Take Aim: scoped (or about to re-scope after a shot) = taking aim. The rifle follows the sim's range.
    applyTakeAim(sim, id, this.player.scope.isScoped || this.player.scope.resumeLevel > 0);
    this.player.stats.range = sim.stats(id).attackRange;

    this.syncPortal(hero);

    for (const [action, abilityId] of LEVEL_KEYS) if (input.pressed(action)) this.learn(hero, abilityId);

    const left = this.clickLeft;
    const right = this.clickRight;
    this.clickLeft = this.clickRight = false;

    if (!hero.alive || hasBuffFlag(hero, 'stunned', now) || hasBuffFlag(hero, 'silenced', now)) {
      if (this.aim.active) this.cancelAim();
      if (this.shrapnelArmed) this.disarm();
      if (this.tpOverlayOpen) this.closeTp();
      this.pendingTp = null;
    }

    // Any move / attack order interrupts a TP channel, like DotA.
    if (this.channel() && (MOVE_ACTIONS.some((a) => input.isDown(a)) || input.pressed('jump') || input.pressed('fire'))) {
      this.interruptPortal(input.pressed('fire') ? 'Attacked' : 'Moved');
    }

    if (this.pendingTp) {
      const p = this.pendingTp;
      this.pendingTp = null;
      this.castPortal(p);
    }

    if (input.pressed('shrapnel')) {
      if (this.aim.active) this.cancelAim();
      if (!this.options.clickToConfirm) this.castShrapnel();
      else if (this.shrapnelArmed) this.disarm();
      else this.arm();
    }
    if (this.shrapnelArmed) {
      if (left) {
        this.castShrapnel();
        this.disarm();
      } else if (right) this.disarm();
    }

    if (input.pressed('assassinate')) {
      if (this.aim.active) this.cancelAim();
      else this.startAim();
    }
    if (this.aim.active) {
      if (right) this.cancelAim();
      else this.updateAim(dt);
    }

    if (input.pressed('townPortal')) {
      if (this.tpOverlayOpen) this.closeTp();
      else this.openTp();
    }
  }

  // --- queries for the view / tests ------------------------------------------------------------

  /** Ground point Shrapnel would land on (crosshair trace clamped to cast range). */
  shrapnelAim(): ShrapnelAim {
    const hero = this.sim.player();
    const level = Math.max(1, skillLevel(hero, SHRAPNEL));
    const range = scaledRange(levelValue(SNIPER_SHRAPNEL, 'castRange', level)) - RANGE_MARGIN;
    const ctl = this.player.controller;
    const r = this.player.aimTrace(range);
    const clamped = r.targetId === null && r.blockedBy === 'range';
    let x: number;
    let y: number;
    if (clamped) {
      x = ctl.position.x + Math.cos(ctl.yaw) * range;
      y = ctl.position.y + Math.sin(ctl.yaw) * range;
    } else {
      x = r.point.x;
      y = r.point.y;
      const dx = x - ctl.position.x;
      const dy = y - ctl.position.y;
      const d = Math.hypot(dx, dy);
      if (d > range) {
        x = ctl.position.x + (dx / d) * range;
        y = ctl.position.y + (dy / d) * range;
      }
    }
    return { x, y, z: groundHeightAt(this.sim.map, x, y), clamped };
  }

  /** Visible enemy hero under the crosshair within Assassinate range, else null. */
  assassinateCandidate(): number | null {
    const hero = this.sim.player();
    const range = this.assassinateRange();
    const r = this.player.aimTrace(range);
    if (r.targetId === null) return null;
    const u = this.sim.get(r.targetId);
    if (!u || !u.alive || u.kind !== 'hero' || u.team === hero.team) return null;
    if (!this.sim.isVisibleTo(hero.team, u.id)) return null;
    if (Math.hypot(u.position.x - hero.position.x, u.position.y - hero.position.y) > range) return null;
    return u.id;
  }

  assassinateRange(): number {
    const level = Math.max(1, skillLevel(this.sim.player(), ASSASSINATE));
    return scaledRange(levelValue(SNIPER_ASSASSINATE, 'castRange', level)) - RANGE_MARGIN;
  }

  assassinateAimTime(): number {
    const level = Math.max(1, skillLevel(this.sim.player(), ASSASSINATE));
    return levelValue(SNIPER_ASSASSINATE, 'aimTime', level);
  }

  /** The hero's TP channel while it is running. */
  channel(): PortalChannel | null {
    const ch = this.systems.portal.channels.get(this.sim.player().id);
    return ch && ch.status === 'channeling' ? ch : null;
  }

  /** Whether the Shrapnel AoE preview should be drawn this frame. */
  previewVisible(): boolean {
    if (this.shrapnelArmed) return true;
    const hero = this.sim.player();
    if (!hero.alive || skillLevel(hero, SHRAPNEL) === 0 || this.aim.active || this.tpOverlayOpen) return false;
    if (this.player.input.isDown('shrapnel')) return true;
    return this.options.showIdlePreview && !this.player.scope.isScoped && (hero.hero?.charges[SHRAPNEL] ?? 0) > 0;
  }

  // --- input from the view (DOM) ------------------------------------------------------------------

  /** Mouse button down while the game has the pointer (or in test mode). */
  mouseDown(button: number): void {
    this.gate.mouseDown(button);
    if (!this.gate.engaged) return;
    if (button === 0) this.clickLeft = true;
    if (button === 2) this.clickRight = true;
  }

  mouseUp(button: number): void {
    this.gate.mouseUp(button);
  }

  /** TP map: the player picked a world point. Applied on the next update. */
  chooseTp(point: Vec2): boolean {
    if (!this.tpOverlayOpen) return false;
    this.pendingTp = { x: point.x, y: point.y };
    this.closeTp();
    return true;
  }

  closeTp(): void {
    if (!this.tpOverlayOpen) return;
    this.tpOverlayOpen = false;
    this.emit({ type: 'tpOverlay', open: false });
  }

  /** Test helpers: same as LMB / RMB while a mode owns the mouse. */
  confirm(): void {
    this.clickLeft = true;
  }

  cancel(): void {
    this.clickRight = true;
  }

  dispose(): void {
    this.aim.cancel();
    this.gate.restore();
    this.listeners.clear();
  }

  // --- actions -------------------------------------------------------------------------------------

  private emit(e: KitEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private message(text: string, tone: 'error' | 'info' = 'error'): void {
    if (this.options.toasts || tone === 'info') this.emit({ type: 'message', text, tone });
  }

  private afterCast(abilityId: string, target?: Vec3, targetId?: number): void {
    if (!this.events) return;
    this.events.emit('player:ability', { abilityId, target, targetId });
    if (this.options.emitAbilityCast) this.events.emit('ability:cast', { unitId: this.sim.player().id, abilityId, target, targetId });
  }

  private learn(hero: UnitState, abilityId: string): void {
    const name = ABILITIES[abilityId]?.name ?? abilityId;
    if (this.sim.learnAbility(hero.id, abilityId)) this.message(`${name} level ${skillLevel(this.sim.get(hero.id), abilityId)}`, 'info');
    else this.message(`Can't learn ${name}`);
  }

  private arm(): void {
    const reason = castBlockReason(this.sim, this.sim.player().id, SHRAPNEL);
    if (reason) {
      this.message(reason);
      return;
    }
    if (this.tpOverlayOpen) this.closeTp();
    this.shrapnelArmed = true;
    this.gate.engage();
  }

  private disarm(): void {
    this.shrapnelArmed = false;
    if (!this.aim.active) this.gate.release();
  }

  private castShrapnel(): boolean {
    const id = this.sim.player().id;
    const reason = castBlockReason(this.sim, id, SHRAPNEL);
    if (reason) {
      this.message(reason);
      return false;
    }
    const t = this.shrapnelAim();
    const res = this.sim.castAbility(id, SHRAPNEL, { point: { x: t.x, y: t.y } });
    if (!res.ok) {
      this.message(res.reason);
      return false;
    }
    if (this.tpOverlayOpen) this.closeTp();
    this.interruptPortal('Interrupted');
    this.afterCast(SHRAPNEL, { x: t.x, y: t.y, z: t.z });
    this.emit({ type: 'shrapnelCast', x: t.x, y: t.y });
    return true;
  }

  private startAim(): void {
    const reason = castBlockReason(this.sim, this.sim.player().id, ASSASSINATE);
    if (reason) {
      this.message(reason);
      return;
    }
    if (this.shrapnelArmed) this.disarm();
    if (this.tpOverlayOpen) this.closeTp();
    this.interruptPortal('Interrupted');
    this.aim.start();
    this.aimStatus = 'searching';
    this.gate.engage();
  }

  private cancelAim(): void {
    this.aim.cancel();
    this.aimStatus = 'idle';
    if (!this.shrapnelArmed) this.gate.release();
  }

  private updateAim(dt: number): void {
    const status = this.aim.update(dt, this.assassinateCandidate(), this.assassinateAimTime(), this.options.aimGrace);
    this.aimStatus = status;
    if (status !== 'fire') return;
    const targetId = this.aim.targetId!;
    this.cancelAim();
    const res = this.sim.castAbility(this.sim.player().id, ASSASSINATE, { targetId });
    if (!res.ok) {
      this.message(res.reason);
      return;
    }
    const t = this.sim.get(targetId);
    this.afterCast(ASSASSINATE, t ? { ...t.position } : undefined, targetId);
    this.emit({ type: 'assassinateFired', targetId });
  }

  private openTp(): void {
    const reason = castBlockReason(this.sim, this.sim.player().id, TOWN_PORTAL);
    if (reason) {
      this.message(reason);
      return;
    }
    if (this.channel()) {
      this.message('Already teleporting');
      return;
    }
    if (this.aim.active) this.cancelAim();
    if (this.shrapnelArmed) this.disarm();
    this.tpOverlayOpen = true;
    this.emit({ type: 'tpOverlay', open: true });
  }

  private castPortal(point: Vec2): void {
    const res = this.sim.castAbility(this.sim.player().id, TOWN_PORTAL, { point });
    if (!res.ok) {
      this.message(res.reason);
      return;
    }
    // Stop dead so leftover momentum doesn't trip the channel's move check.
    const v = this.player.controller.velocity;
    v.x = 0;
    v.y = 0;
    this.afterCast(TOWN_PORTAL, { x: point.x, y: point.y, z: groundHeightAt(this.sim.map, point.x, point.y) });
    this.emit({ type: 'tpStarted' });
  }

  private interruptPortal(reason: string): void {
    const hero = this.sim.player();
    if (cancelPortal(this.systems.portal, hero.id, reason, this.sim.time)) this.syncPortal(hero);
  }

  /** Reports a finished / cancelled TP once and moves the FPS controller to the landing spot. */
  private syncPortal(hero: UnitState): void {
    const ch = this.systems.portal.channels.get(hero.id);
    if (!ch || ch.status === 'channeling' || ch.seq === this.handledPortalSeq) return;
    this.handledPortalSeq = ch.seq;
    if (ch.status === 'done') {
      const ctl = this.player.controller;
      ctl.teleport(ch.landing.x, ch.landing.y);
      // Whatever order the Lead syncs positions in, the sim must not get the pre-teleport spot back.
      this.sim.setUnitPosition(hero.id, ctl.position, ctl.yaw);
      this.emit({ type: 'tpArrived', x: ch.landing.x, y: ch.landing.y });
    } else {
      this.message(`Teleport cancelled: ${ch.reason ?? 'interrupted'}`);
      this.emit({ type: 'tpCancelled', reason: ch.reason ?? 'interrupted' });
    }
  }
}
