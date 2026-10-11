// Public audio API (agent H): procedural WebAudio, no samples, no dependencies.
//   const audio = createAudio(sim.events, player, { sim, camera });
// It runs its own rAF ticker (footsteps, listener pose, zoom polling, ambient, the 0:00 horn) and reads
// master / SFX volumes from the UI settings (localStorage), following changes live.
import type { Camera } from 'three';
import { toThree } from '../core/coords';
import type { EventBus } from '../core/events';
import type { SimApi, UnitState } from '../core/sim';
import type { GameEvents, Team, Vec3 } from '../core/types';
import { ABILITIES, levelValue } from '../data';
import { loadSettings, onSettingsChange } from '../ui/settings';
import { Ambient } from './ambient';
import { AudioEngine } from './engine';
import type { Pos3 } from './engine';
import * as S from './sounds';
import type { AttackSound, Voice } from './sounds';

/** The slice of agent C's SniperPlayer audio reads (SniperPlayer satisfies it). */
export interface AudioPlayer {
  readonly scope: { readonly zoomLevel: number };
  readonly controller: { readonly onGround: boolean; readonly horizontalSpeed: number; readonly position: Vec3 };
  readonly stats: { readonly fireInterval: number };
}

export interface AudioOptions {
  /** Unit lookups (positional creep / tower attacks, kill stingers, horn, day/night ambient). */
  sim?: SimApi;
  /** Listener pose for 3D sounds. */
  camera?: Camera;
  /** Ambient birds / crickets (default true). */
  ambient?: boolean;
}

export type SoundName =
  | 'rifle'
  | 'bolt'
  | 'zoom'
  | 'hit'
  | 'headshot'
  | 'shrapnelLaunch'
  | 'shrapnelImpact'
  | 'assassinateCharge'
  | 'assassinateShot'
  | 'tpHum'
  | 'tpWhoosh'
  | 'footstep'
  | 'rune'
  | 'levelUp'
  | 'gold'
  | 'horn'
  | 'victory'
  | 'defeat'
  | S.StingerKind;

export interface GameAudio {
  setVolume(kind: 'master' | 'sfx', value: number): void;
  /** Play a sound by name (optionally at a WC3 position). Hooks for other modules / dev. */
  play(name: SoundName, at?: Vec3): void;
  /** True once the AudioContext is running (after the first user gesture). */
  readonly ready: boolean;
  dispose(): void;
}

/** Seconds between footsteps for a horizontal speed (CS 1.6: silent below 150 u/s while walking). Pure. */
export const footstepInterval = (speed: number): number | null => {
  if (speed < 150) return null;
  return speed >= 220 ? 0.3 : 0.4;
};

const attackKind = (u: UnitState): AttackSound | null => {
  switch (u.kind) {
    case 'creep_melee':
      return 'melee';
    case 'creep_ranged':
      return 'ranged';
    case 'creep_siege':
      return 'siege';
    case 'tower':
      return 'tower';
    case 'hero':
      return u.def.attackRange > 200 ? 'hero_ranged' : 'hero_melee';
    case 'neutral':
    case 'roshan':
    case 'summon':
      return u.def.attackRange > 200 ? 'ranged' : 'melee';
    default:
      return null;
  }
};

export const createAudio = (events: EventBus<GameEvents>, player?: AudioPlayer, opts: AudioOptions = {}): GameAudio => {
  const e = new AudioEngine();
  const settings = loadSettings();
  e.setVolume('master', settings.masterVolume);
  e.setVolume('sfx', settings.sfxVolume);
  const offSettings = onSettingsChange((s) => {
    e.setVolume('master', s.masterVolume);
    e.setVolume('sfx', s.sfxVolume);
  });
  const sim = opts.sim;
  const ambient = opts.ambient === false ? null : new Ambient(e);
  const team: Team = sim ? sim.player().team : 'sentinel';
  const live = (): boolean => !!e.ctx && e.ctx.state === 'running';
  const playerId = (): number | null => (sim ? sim.player().id : null);
  const wc3ToPos = (x: number, y: number, z: number): Pos3 => {
    const v = toThree(x, y, z);
    return { x: v.x, y: v.y, z: v.z };
  };
  const unitPos = (u: UnitState): Pos3 => wc3ToPos(u.position.x, u.position.y, u.position.z + 60);

  // Rate limiting for crowded fights.
  let attackWindowStart = 0;
  let attacksInWindow = 0;
  let lastGold = 0;
  let charge: { voice: Voice; at: number; aim: number } | null = null;
  let lastAssassinShot = -10;
  let hum: { voice: Voice; until: number } | null = null;
  let lastTpCast = -10;
  let lastShrapnel = -10;
  let lastZoom = player?.scope.zoomLevel ?? 0;

  const assassinAim = (): number => {
    const def = ABILITIES.sniper_assassinate;
    if (!def) return 1.7;
    const lvl = sim?.player().hero?.skillLevels.sniper_assassinate ?? 1;
    return levelValue(def, 'aimTime', Math.max(1, lvl));
  };

  const startCharge = (): void => {
    const n = performance.now() / 1000;
    if (charge && n - charge.at < charge.aim + 0.5) return;
    const aim = assassinAim();
    charge = { voice: S.assassinateCharge(e, aim), at: n, aim };
  };

  const shotAssassinate = (): void => {
    const n = performance.now() / 1000;
    if (n - lastAssassinShot < 0.5) return;
    lastAssassinShot = n;
    charge?.voice.stop(0.05);
    charge = null;
    S.assassinateShot(e);
  };

  const startTp = (): void => {
    const n = performance.now() / 1000;
    if (n - lastTpCast < 1) return;
    lastTpCast = n;
    const def = ABILITIES.item_tpscroll;
    const dur = def ? levelValue(def, 'channelTime', 1) : 3;
    hum?.voice.stop();
    hum = { voice: S.tpHum(e, dur), until: n + dur + 0.6 };
  };

  const onPlayerAbility = (abilityId: string, target?: Vec3): void => {
    if (abilityId === 'sniper_assassinate') startCharge();
    else if (abilityId === 'item_tpscroll') startTp();
    else if (abilityId === 'sniper_shrapnel') {
      const n = performance.now() / 1000;
      if (n - lastShrapnel < 0.5) return;
      lastShrapnel = n;
      S.shrapnelLaunch(e);
      const def = ABILITIES.sniper_shrapnel;
      const first = def ? levelValue(def, 'firstTickDelay', 1) : 0.8;
      const ticks = def ? levelValue(def, 'ticks', 1) : 10;
      const pos = target ? wc3ToPos(target.x, target.y, target.z + 40) : null;
      S.shrapnelBurst(e, first, pos);
      for (let i = 1; i < ticks; i++) S.shrapnelCrackle(e, e.now + first + i, pos);
    }
  };

  const unsub = [
    events.on('player:shot', (ev) => {
      if (!live()) return;
      S.rifleShot(e);
      S.boltCycle(e, player?.stats.fireInterval ?? 1.4);
      if (ev.result.targetId !== null) {
        if (ev.result.part === 'head') S.headshotDink(e);
        else S.hitTick(e);
      }
    }),
    events.on('player:zoom', (ev) => {
      lastZoom = ev.level;
      if (live()) S.zoomClick(e, ev.level);
    }),
    events.on('player:ability', (ev) => {
      if (live()) onPlayerAbility(ev.abilityId, ev.target);
    }),
    events.on('ability:cast', (ev) => {
      if (!live()) return;
      const pid = playerId();
      if (pid !== null && ev.unitId !== pid) return;
      onPlayerAbility(ev.abilityId, ev.target);
    }),
    events.on('projectile:launched', (ev) => {
      if (!live() || ev.sourceId !== playerId()) return;
      if (/assassin/i.test(ev.visual) || (charge && ev.speed >= 2400)) shotAssassinate();
    }),
    events.on('unit:attack', (ev) => {
      if (!live() || !sim) return;
      const u = sim.get(ev.sourceId);
      if (!u || u.hero?.isPlayer) return;
      const kind = attackKind(u);
      if (!kind) return;
      const pos = unitPos(u);
      if (!e.inRange(pos)) return;
      const n = e.now;
      if (n - attackWindowStart > 0.1) {
        attackWindowStart = n;
        attacksInWindow = 0;
      }
      if (++attacksInWindow > 8) return;
      S.attackSound(e, kind, pos);
    }),
    events.on('unit:died', (ev) => {
      if (!live()) return;
      const pid = playerId();
      if (pid === null) return;
      if (ev.unitId === pid) {
        S.deathThud(e);
        hum?.voice.stop();
        charge?.voice.stop();
        return;
      }
      const v = sim?.get(ev.unitId);
      if (ev.killerId === pid && v?.hero && !ev.denied) S.stinger(e, 'playerKill');
    }),
    events.on('rune:picked', (ev) => {
      if (live() && (playerId() === null || ev.unitId === playerId())) S.runePickup(e);
    }),
    events.on('hero:levelUp', (ev) => {
      if (live() && (playerId() === null || ev.unitId === playerId())) S.levelUp(e);
    }),
    events.on('gold:changed', (ev) => {
      if (!live() || ev.delta <= 1 || (playerId() !== null && ev.unitId !== playerId())) return;
      const n = e.now;
      if (n - lastGold < 0.08) return;
      lastGold = n;
      S.goldClink(e, ev.delta >= 150);
    }),
    events.on('item:bought', (ev) => {
      if (live() && (playerId() === null || ev.unitId === playerId())) S.purchase(e);
    }),
    events.on('announce', (ev) => {
      if (live()) S.stinger(e, S.stingerFor(ev.text), ev.text);
    }),
    events.on('match:ended', (ev) => {
      if (!live()) return;
      if (ev.winner === team) S.victory(e);
      else S.defeat(e);
    }),
  ];

  // --- per-frame ticker ----------------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let stepAcc = 0;
  let stepLeft = false;
  let lastSimTime = sim?.time ?? 0;
  let lastPos: Vec3 | null = null;

  const tick = (nowMs: number): void => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    if (opts.camera) {
      opts.camera.updateMatrixWorld();
      e.setListener(opts.camera.matrixWorld.elements);
    }
    if (!live()) return;
    if (player) {
      const zl = player.scope.zoomLevel;
      if (zl !== lastZoom) {
        lastZoom = zl;
        S.zoomClick(e, zl);
      }
      const c = player.controller;
      const interval = c.onGround ? footstepInterval(c.horizontalSpeed) : null;
      if (interval === null) stepAcc = 0.2;
      else {
        stepAcc += dt;
        if (stepAcc >= interval) {
          stepAcc = 0;
          stepLeft = !stepLeft;
          S.footstep(e, stepLeft);
        }
      }
    }
    // Teleport detection ends the TP hum with the whoosh.
    const pos = sim ? sim.player().position : player?.controller.position;
    if (pos) {
      if (lastPos && Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > 800 && hum) {
        hum.voice.stop(0.1);
        hum = null;
        S.tpWhoosh(e);
      }
      lastPos = { x: pos.x, y: pos.y, z: pos.z };
    }
    const n = performance.now() / 1000;
    if (hum && n > hum.until) hum = null;
    if (charge && n > charge.at + charge.aim + 0.6) {
      charge.voice.stop();
      charge = null;
    }
    if (sim) {
      if (lastSimTime < 0 && sim.time >= 0) S.matchHorn(e);
      lastSimTime = sim.time;
    }
    ambient?.update(dt, sim ? sim.isDay : true);
  };
  raf = requestAnimationFrame(tick);

  const play = (name: SoundName, at?: Vec3): void => {
    if (!live()) return;
    const pos = at ? wc3ToPos(at.x, at.y, at.z) : null;
    switch (name) {
      case 'rifle':
        return S.rifleShot(e, 1, pos);
      case 'bolt':
        return S.boltCycle(e, player?.stats.fireInterval ?? 1.4);
      case 'zoom':
        return S.zoomClick(e, 1);
      case 'hit':
        return S.hitTick(e);
      case 'headshot':
        return S.headshotDink(e);
      case 'shrapnelLaunch':
        return S.shrapnelLaunch(e, pos);
      case 'shrapnelImpact':
        return S.shrapnelBurst(e, 0, pos);
      case 'assassinateCharge':
        return startCharge();
      case 'assassinateShot':
        return shotAssassinate();
      case 'tpHum':
        return startTp();
      case 'tpWhoosh':
        return S.tpWhoosh(e);
      case 'footstep':
        return S.footstep(e, true);
      case 'rune':
        return S.runePickup(e);
      case 'levelUp':
        return S.levelUp(e);
      case 'gold':
        return S.goldClink(e, true);
      case 'horn':
        return S.matchHorn(e);
      case 'victory':
        return S.victory(e);
      case 'defeat':
        return S.defeat(e);
      default:
        return S.stinger(e, name);
    }
  };

  return {
    setVolume: (kind, v) => e.setVolume(kind, v),
    play,
    get ready() {
      return live();
    },
    dispose() {
      cancelAnimationFrame(raf);
      for (const fn of unsub) fn();
      offSettings();
      hum?.voice.stop();
      charge?.voice.stop();
      ambient?.dispose();
      e.dispose();
    },
  };
};
