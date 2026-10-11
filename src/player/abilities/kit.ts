// createSniperKit(): the FPS side of Sniper's abilities — KitLogic (input → casts) plus the ability-specific VFX and
// overlays. The sim side (AbilityImpls) is registered by registerSniperAbilities(sim), which this calls idempotently.
import { Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { toThree } from '../../core/coords';
import type { EventBus } from '../../core/events';
import { groundHeightAt } from '../../core/map';
import type { LoadedMap } from '../../core/map';
import type { SimApi } from '../../core/sim';
import type { GameEvents, Vec2 } from '../../core/types';
import type { SniperPlayer } from '../index';
import { forwardFromAngles, upFromAngles, vec3 } from '../math';
import { ASSASSINATE_VISUAL, BUFF, SHRAPNEL } from './ids';
import { KitLogic } from './kitLogic';
import type { KitOptions } from './kitLogic';
import { ChannelBar } from './ui/channelBar';
import { KitHud } from './ui/hud';
import { AssassinateReticle } from './ui/reticle';
import { ensureKitStyles } from './ui/styles';
import { TpMapOverlay } from './ui/tpMap';
import { AssassinateVfx } from './vfx/assassinateVfx';
import type { HeightFn } from './vfx/drape';
import { PortalVfx } from './vfx/portalVfx';
import { ShrapnelVfx } from './vfx/shrapnelVfx';

export interface SniperKitDeps {
  sim: SimApi;
  player: SniperPlayer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** DOM overlay root (#ui). */
  ui: HTMLElement;
  events: EventBus<GameEvents>;
  map: LoadedMap;
  /** Visual ground height for draped rings (e.g. world.heightAt). Defaults to the map heightfield. */
  heightAt?: HeightFn;
  options?: KitOptions;
}

export interface SniperKit {
  readonly logic: KitLogic;
  /** Fixed sim tick: call right after player.update(dt), before sim.step(dt). */
  update(dt: number): void;
  /** Per frame: call after player.render() (camera is current), before renderer.render(). */
  render(frameDt: number): void;
  dispose(): void;
}

export interface KitSnapshot {
  heroId: number;
  time: number;
  level: number;
  mana: number;
  maxMana: number;
  skills: Record<string, number>;
  charges: number;
  cooldowns: Record<string, number>;
  items: Array<string | null>;
  range: number;
  takeAimBonus: number;
  fields: Array<{ id: number; x: number; y: number; ticksDone: number }>;
  shrapnelVisuals: number;
  aim: { active: boolean; targetId: number | null; progress: number; status: string };
  tp: { overlayOpen: boolean; channeling: boolean; status: string | null; landing: Vec2 | null; anchor: string | null };
  /** Assassinate bullets launched / currently flying (render side). */
  bulletsLaunched: number;
  bulletsActive: number;
  position: { x: number; y: number; z: number };
}

export interface KitTestHooks {
  readonly state: KitSnapshot;
  readonly logic: KitLogic;
  /** Picks a TP destination as if clicked on the map (must be open). */
  chooseTp(x: number, y: number): boolean;
  /** CSS pixel position of a world point on the open TP map. */
  tpScreenPoint(x: number, y: number): Vec2;
  /** LMB / RMB while an ability mode owns the mouse. */
  confirm(): void;
  cancel(): void;
}

declare global {
  interface Window {
    __kit?: KitTestHooks;
  }
}

export const createSniperKit = (deps: SniperKitDeps): SniperKit => {
  const { sim, player, scene, camera, ui, events, map } = deps;
  const heightAt: HeightFn = deps.heightAt ?? ((x, y) => groundHeightAt(map, x, y));
  ensureKitStyles();
  const root = document.createElement('div');
  root.className = 'kit-root';
  ui.appendChild(root);

  const logic = new KitLogic(sim, player, events, deps.options);
  const shrapnelVfx = new ShrapnelVfx(scene, heightAt);
  const assassinateVfx = new AssassinateVfx(scene);
  const portalVfx = new PortalVfx(scene, heightAt);
  const hud = new KitHud(root);
  const reticle = new AssassinateReticle(root);
  const channelBar = new ChannelBar(root);
  const relock = (): void => {
    if (!player.input.testMode) player.input.requestLock();
  };
  const tpMap = new TpMapOverlay(
    root,
    sim,
    logic,
    (point) => {
      logic.chooseTp(point);
      relock();
    },
    () => {
      logic.closeTp();
      relock();
    },
  );

  // --- muzzle position (three space), matching the rifle tracer origin --------------------------------
  const muzzleV = new Vector3();
  const eye = vec3();
  const fwd = vec3();
  const up = vec3();
  const muzzle = (out: Vector3): Vector3 => {
    const ctl = player.controller;
    if (player.scope.isScoped) {
      // Rifle hidden by the scope: just under the eye.
      ctl.eye(eye);
      forwardFromAngles(ctl.yaw, ctl.pitch, fwd);
      upFromAngles(ctl.yaw, ctl.pitch, up);
      return toThree(eye.x + fwd.x * 24 - up.x * 5, eye.y + fwd.y * 24 - up.y * 5, eye.z + fwd.z * 24 - up.z * 5, out);
    }
    player.viewmodel.muzzleNdc(out);
    return out.set(out.x, out.y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(40).add(camera.position);
  };

  // --- kit events → visuals ------------------------------------------------------------------------------
  const unsub: Array<() => void> = [];
  unsub.push(
    logic.on((e) => {
      switch (e.type) {
        case 'message':
          hud.message(e.text, e.tone);
          break;
        case 'tpOverlay':
          tpMap.setOpen(e.open);
          if (e.open && !player.input.testMode && document.pointerLockElement) document.exitPointerLock();
          break;
        case 'assassinateFired': {
          muzzle(muzzleV);
          assassinateVfx.muzzleFlash(muzzleV);
          const ctl = player.controller;
          ctl.eye(eye);
          forwardFromAngles(ctl.yaw, ctl.pitch, fwd);
          player.effects.muzzleFlash({ x: eye.x + fwd.x * 40, y: eye.y + fwd.y * 40, z: eye.z + fwd.z * 40 });
          player.viewmodel.onFire(1.2);
          hud.screenFlash();
          break;
        }
        case 'tpArrived':
          portalVfx.arrive(e.x, e.y, heightAt(e.x, e.y));
          break;
        default:
          break;
      }
    }),
  );
  let bulletsLaunched = 0;
  unsub.push(
    events.on('projectile:launched', (p) => {
      if (p.visual !== ASSASSINATE_VISUAL || p.sourceId !== sim.player().id) return;
      bulletsLaunched++;
      assassinateVfx.launch(p.projectileId, p.targetId, p.speed, muzzle(muzzleV));
    }),
  );
  unsub.push(events.on('projectile:hit', (p) => assassinateVfx.hit(p.projectileId, sim)));

  // --- mouse buttons for click-to-confirm / aim cancel ---------------------------------------------------
  const onDown = (e: MouseEvent): void => {
    if (player.input.active && !tpMap.isOpen) logic.mouseDown(e.button);
  };
  const onUp = (e: MouseEvent): void => logic.mouseUp(e.button);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);

  // --- per-frame -------------------------------------------------------------------------------------------
  const laserTo = new Vector3();
  const renderLaser = (): void => {
    if (!logic.aim.active) {
      assassinateVfx.hideLaser();
      return;
    }
    const r = player.aimTrace(logic.assassinateRange());
    const locked = logic.aim.targetId !== null;
    assassinateVfx.setLaser(muzzle(muzzleV), toThree(r.point.x, r.point.y, r.point.z, laserTo), locked, logic.aim.progress(logic.assassinateAimTime()));
  };

  const snapshot = (): KitSnapshot => {
    const hero = sim.player();
    const h = hero.hero;
    const ch = logic.systems.portal.channels.get(hero.id);
    const now = sim.time;
    return {
      heroId: hero.id,
      time: now,
      level: h?.level ?? 0,
      mana: hero.mana,
      maxMana: hero.maxMana,
      skills: { ...(h?.skillLevels ?? {}) },
      charges: h?.charges[SHRAPNEL] ?? 0,
      cooldowns: Object.fromEntries(Object.entries(h?.cooldownReadyAt ?? {}).map(([k, v]) => [k, Math.max(0, v - now)])),
      items: [...(h?.items ?? [])],
      range: player.stats.range,
      takeAimBonus: hero.buffs.find((b) => b.id === BUFF.takeAim)?.attackRange ?? 0,
      fields: logic.systems.shrapnel.fields.map((f) => ({ id: f.id, x: f.x, y: f.y, ticksDone: f.ticksDone })),
      shrapnelVisuals: shrapnelVfx.fieldVisualCount,
      aim: { active: logic.aim.active, targetId: logic.aim.targetId, progress: logic.aim.progress(logic.assassinateAimTime()), status: logic.aimStatus },
      tp: { overlayOpen: logic.tpOverlayOpen, channeling: logic.channel() !== null, status: ch?.status ?? null, landing: ch ? { ...ch.landing } : null, anchor: ch?.anchor.name ?? null },
      bulletsLaunched,
      bulletsActive: assassinateVfx.activeBullets,
      position: { ...player.controller.position },
    };
  };

  if (player.input.testMode) {
    window.__kit = {
      get state() {
        return snapshot();
      },
      logic,
      chooseTp: (x, y) => logic.chooseTp({ x, y }),
      tpScreenPoint: (x, y) => tpMap.screenPoint(x, y),
      confirm: () => logic.confirm(),
      cancel: () => logic.cancel(),
    };
  }

  return {
    logic,
    update(dt) {
      logic.update(dt);
    },
    render(frameDt) {
      shrapnelVfx.update(frameDt, sim, logic);
      renderLaser();
      assassinateVfx.update(frameDt, sim);
      const ch = logic.channel();
      portalVfx.update(
        frameDt,
        ch ? { progress: Math.min(1, Math.max(0, (sim.time - ch.startAt) / Math.max(1e-6, ch.endAt - ch.startAt))), feet: player.controller.position, landing: ch.landing } : null,
      );
      hud.update(frameDt, sim, logic);
      reticle.update(sim, logic);
      channelBar.update(ch, sim.time);
      tpMap.render();
    },
    dispose() {
      for (const fn of unsub) fn();
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      logic.dispose();
      shrapnelVfx.dispose();
      assassinateVfx.dispose();
      portalVfx.dispose();
      hud.dispose();
      reticle.dispose();
      channelBar.dispose();
      tpMap.dispose();
      root.remove();
      if (window.__kit?.logic === logic) delete window.__kit;
    },
  };
};
