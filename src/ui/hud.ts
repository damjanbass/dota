// createHud(): wires every HUD part to the sim, the player and the event bus, and owns the UI-side
// pointer-lock flow (shop releases the mouse, unexpected unlock → pause menu, match end → end screen).
import type { Camera } from 'three';
import type { EventBus } from '../core/events';
import type { LoadedMap } from '../core/map';
import type { SimApi, UnitState } from '../core/sim';
import type { GameEvents, Team } from '../core/types';
import type { Action } from '../player/input';
import { createAbilityBar } from './abilities';
import type { HudContext, HudPart, HudPlayer } from './context';
import { createDeathScreen } from './death';
import { collectEndStats, showEndScreen } from './endScreen';
import { createGoldInventory } from './inventory';
import { createKillFeed } from './killFeed';
import type { Menus } from './menus';
import { createMinimap } from './minimap';
import { createScoreboard } from './scoreboard';
import { createShop } from './shop';
import { createStatus } from './status';
import { ensureStyles, el } from './style';
import { createTopBar } from './topbar';
import { createWorldOverlay } from './worldOverlay';

export interface CreateHudOptions {
  /** The #ui overlay (pointer-events: none). */
  root: HTMLElement;
  sim: SimApi;
  player: HudPlayer;
  events: EventBus<GameEvents>;
  map: LoadedMap;
  /** The world camera (after player.render() has updated it this frame). */
  camera: Camera;
  /** Enables the pause menu on unexpected pointer-lock loss and routes the end screen through it. */
  menus?: Menus;
  /** Pause opened / closed (e.g. stop stepping the sim while paused). */
  onPauseChange?: (paused: boolean) => void;
  /** Player left the match: "Quit to menu" in the pause menu, or "Main Menu" on the end screen. */
  onExit?: (reason: 'quit' | 'ended') => void;
  /** HUD handles Ctrl+Q/E/R/G → sim.learnAbility (default true). Pass false if the kit does it. */
  learnKeys?: boolean;
  /** The human's team (default Sentinel). */
  team?: Team;
}

export interface Hud {
  /** Call once per animation frame after player.render(); alpha = sim interpolation factor. */
  update(frameDt: number, alpha?: number): void;
  readonly shopOpen: boolean;
  setShopOpen(open: boolean): void;
  /** Force the scoreboard on (dev / screenshots); Tab still works when false. */
  setScoreboardPinned(on: boolean): void;
  /** Select an item in the shop (dev / tutorials). */
  shopSelect(itemId: string): void;
  dispose(): void;
}

export const unitDisplayName = (u: UnitState | undefined): string => {
  if (!u) return 'Unknown';
  return u.def.name;
};

export const createHud = (opts: CreateHudOptions): Hud => {
  ensureStyles();
  const hudRoot = el('div', 'hud');
  opts.root.appendChild(hudRoot);
  const team = opts.team ?? 'sentinel';
  const ctx: HudContext = {
    root: hudRoot,
    sim: opts.sim,
    player: opts.player,
    events: opts.events,
    map: opts.map,
    camera: opts.camera as HudContext['camera'],
    team,
    now: () => performance.now() / 1000,
    unitName: unitDisplayName,
  };

  const world = createWorldOverlay(ctx, hudRoot);
  const minimap = createMinimap(ctx, hudRoot);
  const status = createStatus(ctx, hudRoot);
  const abilities = createAbilityBar(ctx, hudRoot, { learnKeys: opts.learnKeys !== false });
  const inventory = createGoldInventory(ctx, hudRoot);
  const top = createTopBar(ctx, hudRoot);
  const feed = createKillFeed(ctx, hudRoot);
  const death = createDeathScreen(ctx, hudRoot);
  const scoreboard = createScoreboard(ctx, hudRoot);
  let pinnedScore = false;

  // --- pointer lock + overlays -------------------------------------------------------------------
  let expectUnlock = false;
  let everLocked = !!document.pointerLockElement;
  let paused = false;
  let ended = false;
  const input = opts.player.input;

  const releaseMouse = (): void => {
    if (document.pointerLockElement) {
      expectUnlock = true;
      document.exitPointerLock();
    }
  };

  const shop = createShop(ctx, hudRoot, () => setShop(false));
  const setShop = (open: boolean): void => {
    if (ended || open === shop.open) return;
    shop.setOpen(open);
    if (open) releaseMouse();
    else if (!input.testMode) input.requestLock();
  };

  const onPress = (a: Action): void => {
    if (a === 'shop' && !paused) setShop(!shop.open);
  };
  input.pressListeners.add(onPress);

  const pause = async (): Promise<void> => {
    if (!opts.menus || paused || ended) return;
    paused = true;
    opts.onPauseChange?.(true);
    const choice = await opts.menus.showPause();
    paused = false;
    opts.onPauseChange?.(false);
    if (choice === 'quit') opts.onExit?.('quit');
    else input.requestLock();
  };

  const onLockChange = (): void => {
    const locked = document.pointerLockElement !== null;
    if (locked) {
      everLocked = true;
      expectUnlock = false;
      if (shop.open) shop.setOpen(false);
      return;
    }
    if (expectUnlock) {
      expectUnlock = false;
      return;
    }
    if (everLocked && !input.testMode && !shop.open) void pause();
  };
  document.addEventListener('pointerlockchange', onLockChange);

  const offEnd = opts.events.on('match:ended', (e) => {
    if (ended) return;
    ended = true;
    shop.setOpen(false);
    scoreboard.setOpen(false);
    releaseMouse();
    const stats = collectEndStats(opts.sim);
    const done = async (): Promise<void> => {
      if (opts.menus) await opts.menus.showEnd(e.winner, stats);
      else await showEndScreen(opts.root, e.winner, stats, team);
      opts.onExit?.('ended');
    };
    void done();
  });

  const parts: HudPart[] = [world, minimap, status, abilities, inventory, top, feed, death, scoreboard, shop];

  return {
    update(frameDt, alpha = 1) {
      scoreboard.setOpen(!ended && (pinnedScore || input.isDown('scoreboard')));
      for (const p of parts) p.update(frameDt, alpha);
    },
    get shopOpen() {
      return shop.open;
    },
    setShopOpen: setShop,
    setScoreboardPinned(on: boolean) {
      pinnedScore = on;
    },
    shopSelect(itemId: string) {
      shop.select(itemId);
    },
    dispose() {
      input.pressListeners.delete(onPress);
      document.removeEventListener('pointerlockchange', onLockChange);
      offEnd();
      for (const p of parts) p.dispose();
      hudRoot.remove();
    },
  };
};
