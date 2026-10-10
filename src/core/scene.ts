import type { LoadedMap } from './map';

export interface SceneContext {
  canvas: HTMLCanvasElement;
  /** DOM overlay for HUD / debug text (pointer-events: none by default). */
  ui: HTMLElement;
  map: LoadedMap;
}

/** Every dev scene module exports `run`. Selected with ?scene=<name> (see main.ts). */
export type SceneRunner = (ctx: SceneContext) => Promise<void> | void;

declare global {
  interface Window {
    __sceneReady?: boolean;
    __sceneName?: string;
  }
}

/** Call once the scene has rendered its first frame. e2e tests wait for this flag. */
export const markSceneReady = (): void => {
  window.__sceneReady = true;
};
