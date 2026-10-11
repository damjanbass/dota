// Ability implementations for the 5 enemy hero kits and Roshan. Register once per sim.
import type { AbilityImpl, SimApi } from '../../core/sim';
import { HOOK_DRAG_BUFF } from './pudge';
import { kitState } from './common';
import { lichAbilities } from './lich';
import { lionAbilities } from './lion';
import { neutralAbilities } from './neutral';
import { pudgeAbilities } from './pudge';
import { shadowFiendAbilities } from './shadowFiend';
import { viperAbilities } from './viper';

export * from './common';
export * from './lich';
export * from './lion';
export * from './neutral';
export * from './pudge';
export * from './shadowFiend';
export * from './viper';

const registered = new WeakSet<SimApi>();

/** Drops a dead caster's skillshots and channels (dead units don't tick, so nothing else would). */
const watchDeaths = (sim: SimApi): void => {
  if (registered.has(sim)) return;
  registered.add(sim);
  sim.events.on('unit:died', ({ unitId }) => {
    const s = kitState(sim);
    for (const shot of s.skillshots.filter((x) => x.casterId === unitId)) {
      if (shot.targetId !== undefined) sim.removeBuff(shot.targetId, HOOK_DRAG_BUFF);
      s.skillshots.splice(s.skillshots.indexOf(shot), 1);
    }
    s.channels.delete(unitId);
    s.requiemPending.delete(unitId);
    s.poisonPending.delete(unitId);
  });
};

/** Every hero ability impl (Pudge, Lion, Viper, Shadow Fiend, Lich) bound to this sim's events. */
export const heroAbilityImpls = (sim: SimApi): AbilityImpl[] => [
  ...pudgeAbilities(sim),
  ...lionAbilities(sim),
  ...viperAbilities(sim),
  ...shadowFiendAbilities(sim),
  ...lichAbilities(sim),
];

export const registerHeroAbilities = (sim: SimApi): void => {
  watchDeaths(sim);
  for (const impl of heroAbilityImpls(sim)) sim.registerAbility(impl);
};

export const registerNeutralAbilities = (sim: SimApi): void => {
  watchDeaths(sim);
  for (const impl of neutralAbilities(sim)) sim.registerAbility(impl);
};
