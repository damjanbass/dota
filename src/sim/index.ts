// Public entry point of the DotA 6.83d simulation (agent E).
//   const sim = createSim(map, { seed: 1, playerHero: 'sniper', allies: [], enemies: ['pudge'], difficulty: 'medium' });
//   startLoop({ update: (dt) => sim.step(dt), render: ... });
import type { LoadedMap } from '../core/map';
import type { MatchConfig } from '../core/sim';
import type { SimOptions, SimWorld } from './types';
import { World } from './world';

export type { Behaviour, ProjectileState, RuneKind, RuneState, SimBuff, SimHero, SimOptions, SimUnit, SimWorld } from './types';
export { hittablesFor, hitShape } from './hittables';
export { TUNABLES } from './tunables';
export { DENY_THRESHOLD } from './combat';
export { waveComposition, upgradeLevel } from './waves';

/** Creates a deterministic, headless match simulation. */
export const createSim = (map: LoadedMap, config: MatchConfig, opts?: SimOptions): SimWorld => new World(map, config, opts);
