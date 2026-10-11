// Shared types for the HUD modules.
import type { Camera } from 'three';
import type { EventBus } from '../core/events';
import type { LoadedMap } from '../core/map';
import type { SimApi, UnitState } from '../core/sim';
import type { GameEvents, Team } from '../core/types';
import type { Action } from '../player/input';

/**
 * The slice of agent C's SniperPlayer the HUD reads (structural, so tests / fakes can pass a stub).
 * SniperPlayer satisfies it as-is.
 */
export interface HudPlayer {
  readonly input: {
    readonly pressListeners: Set<(action: Action) => void>;
    isDown(action: Action): boolean;
    requestLock(): void;
    readonly locked: boolean;
    readonly testMode: boolean;
  };
  readonly scope: { readonly isScoped: boolean; readonly zoomLevel: number };
  readonly controller: { readonly yaw: number };
}

export interface HudContext {
  root: HTMLElement;
  sim: SimApi;
  player: HudPlayer;
  events: EventBus<GameEvents>;
  map: LoadedMap;
  camera: Camera & { fov?: number };
  /** The human player's team (always Sentinel for now). */
  team: Team;
  /** Wall-clock seconds (animations keep running while the sim is paused). */
  now(): number;
  /** Display name for a unit (hero name, creep / building name). */
  unitName(u: UnitState | undefined): string;
}

export interface HudPart {
  update(frameDt: number, alpha: number): void;
  dispose(): void;
}
