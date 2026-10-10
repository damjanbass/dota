// Placeholder — owned by agent C (FPS Feel). Replace with the FPS test range scene.
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

export const run: SceneRunner = ({ ui }) => {
  ui.textContent = 'fps scene: not implemented yet';
  markSceneReady();
};
