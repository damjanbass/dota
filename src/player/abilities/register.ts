// registerSniperAbilities(sim): registers Shrapnel, Headshot, Take Aim, Assassinate and the Town Portal Scroll impls.
import type { SimApi } from '../../core/sim';
import { createAssassinateImpl } from './assassinate';
import { createHeadshotImpl } from './headshot';
import { createShrapnelImpl } from './shrapnel';
import { getSniperSystems } from './systems';
import type { SniperSystems } from './systems';
import { createTakeAimImpl } from './takeAim';
import { createTownPortalImpl } from './townPortal';

const registered = new WeakSet<SimApi>();

/** Idempotent: registers the impls once per sim and returns the kit's sim-side state. */
export const registerSniperAbilities = (sim: SimApi): SniperSystems => {
  const sys = getSniperSystems(sim);
  if (registered.has(sim)) return sys;
  registered.add(sim);
  const process = (s: SimApi): void => sys.process(s);
  sim.registerAbility(createShrapnelImpl(sys.shrapnel, process));
  sim.registerAbility(createHeadshotImpl());
  sim.registerAbility(createTakeAimImpl());
  sim.registerAbility(createAssassinateImpl());
  sim.registerAbility(createTownPortalImpl(sys.portal, process));
  return sys;
};
