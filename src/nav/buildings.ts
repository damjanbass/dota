// Building footprints as dynamic nav blockers. The map's pathing layer excludes buildings, so they are
// stamped at startup and removed when destroyed ('building:destroyed' carries the map entity id).
import type { LoadedMap, MapEntity } from '../core/map';
import { UNITS } from '../data';
import type { NavGrid } from './grid';

/**
 * Blocker radius for a map entity, or null if it doesn't block. Towers, barracks and ancients use their
 * 6.83d collision radius; fountain / shop / filler sizes match the Lead's player colliders (estimates).
 */
export const buildingFootprint = (e: MapEntity): number | null => {
  const team = e.team === 'scourge' ? 'scourge' : 'sentinel';
  switch (e.kind) {
    case 'tower':
      return UNITS[`${team}_tower_t${e.tier ?? 1}`]?.collisionRadius ?? null;
    case 'barracks_melee':
    case 'barracks_ranged':
      return UNITS[`${team}_${e.kind}`]?.collisionRadius ?? null;
    case 'ancient':
      return UNITS[`${team}_ancient`]?.collisionRadius ?? null;
    case 'fountain':
      return 110;
    case 'shop':
    case 'secret_shop':
    case 'side_shop':
    case 'tavern':
      return 90;
    case 'other':
      // Circles of Power are walkable floor decals.
      return e.typeId === 'ncop' ? null : 72;
    default:
      return null;
  }
};

export interface BuildingStamps {
  /** Removes the blocker of a destroyed building (no-op if unknown or already removed). */
  remove(entityId: number): void;
  /** Entity ids currently stamped. */
  ids(): number[];
}

/** Stamps every building of the map onto the grid. */
export const stampMapBuildings = (grid: NavGrid, map: LoadedMap): BuildingStamps => {
  const stamped = new Map<number, { x: number; y: number; r: number }>();
  for (const e of map.data.entities) {
    const r = buildingFootprint(e);
    if (r === null) continue;
    grid.setBlocked(e.x, e.y, r, true);
    stamped.set(e.id, { x: e.x, y: e.y, r });
  }
  return {
    remove(entityId) {
      const s = stamped.get(entityId);
      if (!s) return;
      stamped.delete(entityId);
      grid.setBlocked(s.x, s.y, s.r, false);
    },
    ids: () => [...stamped.keys()],
  };
};
