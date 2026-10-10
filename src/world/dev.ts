// Placeholder — owned by agent D (World Art). Replace with the world dev scene.
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

export const run: SceneRunner = ({ ui }) => {
  ui.textContent = 'world scene: not implemented yet';
  markSceneReady();
};
