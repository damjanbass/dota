// Per-sim state of the Sniper kit (Shrapnel fields, TP channels) and the idempotent `process` that advances it.
// Ability impls call process() from tick(); the FPS kit also calls it every update so the player's fields and
// channels keep running even if the sim stops ticking an ability (dead caster, scroll consumed).
import type { SimApi } from '../../core/sim';
import { advanceShrapnel, createShrapnelState } from './shrapnel';
import type { ShrapnelState } from './shrapnel';
import { advancePortals, createPortalState } from './townPortal';
import type { PortalState } from './townPortal';

export interface SniperSystems {
  readonly shrapnel: ShrapnelState;
  readonly portal: PortalState;
  /** Advances everything due at sim.time. Safe to call several times per tick. */
  process(sim: SimApi): void;
}

const SYSTEMS = new WeakMap<SimApi, SniperSystems>();

export const getSniperSystems = (sim: SimApi): SniperSystems => {
  let sys = SYSTEMS.get(sim);
  if (!sys) {
    const shrapnel = createShrapnelState();
    const portal = createPortalState();
    sys = {
      shrapnel,
      portal,
      process(s) {
        advanceShrapnel(shrapnel, s);
        advancePortals(portal, s);
      },
    };
    SYSTEMS.set(sim, sys);
  }
  return sys;
};
