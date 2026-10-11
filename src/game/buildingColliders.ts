// Static building collision for the player (movement) and the rifle (shot blocking), built from map entities.
// The sim will call remove() when a building is destroyed.
import type { LoadedMap, MapEntity, MapEntityKind } from '../core/map';
import { UNITS } from '../data';
import type { Obstacle, ObstacleProvider, ShotBlocker } from '../player';

interface Size {
  radius: number;
  height: number;
}

const fromData = (id: string): Size => {
  const def = UNITS[id];
  if (!def) throw new Error(`Unknown unit def ${id}`);
  return { radius: def.collisionRadius, height: def.height };
};

// Collision radii/heights come from src/data (6.83d map data). Fountain/shop/tavern/other footprints are
// Lead estimates: WC3 uses pathing textures for those, which the map data doesn't give us as radii.
const sizeFor = (e: MapEntity): Size | null => {
  const team = e.team === 'scourge' ? 'scourge' : 'sentinel';
  const kind: MapEntityKind = e.kind;
  switch (kind) {
    case 'tower':
      return fromData(`${team}_tower_t${e.tier ?? 1}`);
    case 'barracks_melee':
    case 'barracks_ranged':
      return fromData(`${team}_${kind}`);
    case 'ancient':
      return fromData(`${team}_ancient`);
    case 'fountain':
      return { radius: 110, height: 250 };
    case 'shop':
    case 'secret_shop':
    case 'side_shop':
    case 'tavern':
      return { radius: 90, height: 220 };
    case 'other':
      return { radius: 72, height: 200 };
    default:
      return null;
  }
};

export interface BuildingColliders extends ObstacleProvider {
  readonly blockers: readonly ShotBlocker[];
  remove(entityId: number): void;
}

/**
 * `footprints` (entityId → radius) lets the caller widen colliders to the rendered model's footprint,
 * so the player can't walk into a plinth that is visually wider than the DotA collision radius.
 */
export const createBuildingColliders = (map: LoadedMap, footprints?: ReadonlyMap<number, number>): BuildingColliders => {
  const byId = new Map<number, ShotBlocker>();
  for (const e of map.data.entities) {
    const size = sizeFor(e);
    if (!size) continue;
    const radius = Math.max(size.radius, footprints?.get(e.id) ?? 0);
    byId.set(e.id, { x: e.x, y: e.y, z: e.z, radius, height: size.height });
  }
  let blockers: ShotBlocker[] = [...byId.values()];
  const near: Obstacle[] = [];

  return {
    get blockers() {
      return blockers;
    },
    obstaclesNear(x, y, radius) {
      near.length = 0;
      for (const b of blockers) {
        const reach = b.radius + radius;
        const dx = b.x - x;
        const dy = b.y - y;
        if (dx * dx + dy * dy <= reach * reach) near.push(b);
      }
      return near;
    },
    remove(entityId) {
      if (byId.delete(entityId)) blockers = [...byId.values()];
    },
  };
};
