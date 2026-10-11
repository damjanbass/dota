// Placeholder — owned by agent E (Simulation). Replace with this area's dev scene.
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

export const run: SceneRunner = ({ ui }) => {
  ui.textContent = 'sim scene: not implemented yet';
  markSceneReady();
};
