// Placeholder — owned by agent G (Nav + AI). Replace with this area's dev scene.
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

export const run: SceneRunner = ({ ui }) => {
  ui.textContent = 'ai scene: not implemented yet';
  markSceneReady();
};
