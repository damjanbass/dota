// Client-side pre-checks so aim modes (R lock, F map) don't open when the cast would be refused anyway.
// The sim stays authoritative: castAbility() validates again.
import type { SimApi, UnitState } from '../../core/sim';
import { ABILITIES, ITEMS, levelValue } from '../../data';
import { hasBuffFlag, skillLevel } from './ids';

/** Level to use for an ability: learned skill level, or 1 for an item active held in the inventory. */
export const abilityLevel = (unit: UnitState, abilityId: string): number => {
  const def = ABILITIES[abilityId];
  if (!def) return 0;
  if (def.kind === 'item') return unit.hero?.items.some((it) => it !== null && ITEMS[it]?.active === abilityId) ? 1 : 0;
  return skillLevel(unit, abilityId);
};

/** Null if the cast could start now, otherwise a short player-facing reason. */
export const castBlockReason = (sim: SimApi, unitId: number, abilityId: string): string | null => {
  const unit = sim.get(unitId);
  const def = ABILITIES[abilityId];
  if (!unit || !def) return 'Unavailable';
  if (!unit.alive) return 'Dead';
  const level = abilityLevel(unit, abilityId);
  if (level <= 0) return def.kind === 'item' ? `No ${def.name} Scroll` : `${def.name} not learned`;
  const now = sim.time;
  if (hasBuffFlag(unit, 'stunned', now)) return 'Stunned';
  if (hasBuffFlag(unit, 'silenced', now)) return 'Silenced';
  const readyAt = unit.hero?.cooldownReadyAt[abilityId] ?? -Infinity;
  if (readyAt > now + 1e-9) return `${def.name} on cooldown (${Math.ceil(readyAt - now)}s)`;
  if (def.values.charges && (unit.hero?.charges[abilityId] ?? 0) <= 0) return `No ${def.name} charges`;
  if (unit.mana + 1e-9 < levelValue(def, 'manaCost', level)) return 'Not enough mana';
  return null;
};
