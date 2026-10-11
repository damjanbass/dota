// Ids, buff ids and small unit helpers shared by the Sniper kit (sim side and FPS side).
import type { UnitState } from '../../core/sim';
import type { UnitKind } from '../../core/types';

export const SHRAPNEL = 'sniper_shrapnel';
export const HEADSHOT = 'sniper_headshot';
export const TAKE_AIM = 'sniper_take_aim';
export const ASSASSINATE = 'sniper_assassinate';
/** Town Portal Scroll active ability (the inventory item id is TP_ITEM). */
export const TOWN_PORTAL = 'item_tpscroll';
export const TP_ITEM = 'tpscroll';

/** Projectile `visual` id of the Assassinate bullet (renderers key their effect on it). */
export const ASSASSINATE_VISUAL = 'sniper_assassinate';

export const BUFF = {
  shrapnelSlow: 'sniper_shrapnel_slow',
  headshotSlow: 'sniper_headshot_slow',
  takeAim: 'sniper_take_aim',
  assassinateStun: 'sniper_assassinate_stun',
} as const;

const BUILDING_KINDS: ReadonlySet<UnitKind> = new Set<UnitKind>([
  'tower',
  'barracks_melee',
  'barracks_ranged',
  'ancient',
  'fountain',
  'building',
]);

export const isBuilding = (kind: UnitKind): boolean => BUILDING_KINDS.has(kind);

type BuffFlag = 'stunned' | 'silenced' | 'magicImmune' | 'invulnerable' | 'invisible';

/** True if an unexpired buff on the unit sets the flag. */
export const hasBuffFlag = (unit: UnitState, flag: BuffFlag, now: number): boolean => {
  for (const b of unit.buffs) if (b[flag] === true && b.expiresAt > now) return true;
  return false;
};

/** Learned level of a hero skill (0 if not learned or not a hero). */
export const skillLevel = (unit: UnitState | undefined, abilityId: string): number => unit?.hero?.skillLevels[abilityId] ?? 0;

export const EPS = 1e-6;
