// Placeholder — owned by agent H (UI + Audio). Replace with this area's dev scene.
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

export const run: SceneRunner = ({ ui }) => {
  ui.textContent = 'ui scene: not implemented yet';
  markSceneReady();
};
