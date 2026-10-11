// Maps src/data unit ids to world model ids. Super/mega creeps reuse their base creep model
// (scaled up by the renderer); neutrals without a dedicated model use the closest silhouette.
import { resolveUnitModelId } from '../world';
import type { UnitModelId } from '../world';

const FALLBACKS: Record<string, UnitModelId> = {
  neutral_ghost: 'satyr',
  neutral_fel_beast: 'wolf',
  neutral_polar_furbolg_champion: 'ogre',
  neutral_polar_furbolg_ursa_warrior: 'ogre',
  neutral_enraged_wildkin: 'golem',
  neutral_wildkin: 'golem',
  neutral_jungle_stalker: 'wolf',
  neutral_elder_jungle_stalker: 'wolf',
  neutral_thunder_lizard_large: 'dragon',
  neutral_thunder_lizard_small: 'dragon',
  // Allied-bot Sniper (the player's own hero is never rendered): no Sniper model yet.
  sniper: 'kobold',
};

/** Scale applied on top of the def height for upgraded creeps, so super/mega read bigger. */
export const tierScale = (defId: string): number => (defId.endsWith('_mega') ? 1.2 : defId.endsWith('_super') ? 1.1 : 1);

export const modelIdFor = (defId: string): UnitModelId | null => {
  const base = defId.replace(/_(super|mega)$/, '');
  return FALLBACKS[base] ?? resolveUnitModelId(base);
};
