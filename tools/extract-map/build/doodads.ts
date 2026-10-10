// war3map.doo entries → trees (destructible tree walls) and decorative doodads.
import type { MapData, MapDoodad, MapTreeType } from '../../../src/core/map';
import type { DooEntry } from '../formats/doo';

/**
 * Standard WC3 tree destructables (DestructableData.slk ids + English names). Style picks our tree
 * model; DotA puts Ashenvale trees on the Sentinel side and Northrend trees on the Scourge side.
 * Only ids whose names are certain are listed; DotA 6.83d uses ATtr, ATtc, NTtw and NTtc.
 */
export const TREE_TYPES: Record<string, { name: string; style: MapTreeType['style'] }> = {
  ATtr: { name: 'Ashenvale Tree Wall', style: 'ashenvale' },
  ATtc: { name: 'Ashenvale Canopy Tree', style: 'ashenvale' },
  NTtw: { name: 'Northrend Tree Wall', style: 'northrend' },
  NTtc: { name: 'Northrend Canopy Tree', style: 'northrend' },
  CTtr: { name: 'Felwood Tree Wall', style: 'blight' },
  CTtc: { name: 'Felwood Canopy Tree', style: 'blight' },
  LTlt: { name: 'Lordaeron Summer Tree Wall', style: 'other' },
  BTtw: { name: 'Barrens Tree Wall', style: 'other' },
};

/** WC3 rawcodes: 'YTxx' destructables are pathing blockers (invisible). */
const isPathingBlocker = (id: string): boolean => id.startsWith('YT');
const isTreeId = (id: string): boolean => id in TREE_TYPES;

export interface DoodadBuild {
  treeTypes: MapTreeType[];
  trees: MapData['trees'];
  doodads: MapDoodad[];
  /** Raw entries of trees, for pathing stamps. */
  treeEntries: DooEntry[];
  pathingBlockers: DooEntry[];
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

export const buildDoodads = (entries: DooEntry[], customNames: Map<string, string>): DoodadBuild => {
  const treeTypes: MapTreeType[] = [];
  const typeIndex = new Map<string, number>();
  const trees: MapData['trees'] = [];
  const doodads: MapDoodad[] = [];
  const treeEntries: DooEntry[] = [];
  const pathingBlockers: DooEntry[] = [];
  for (const d of entries) {
    if (isPathingBlocker(d.id)) {
      pathingBlockers.push(d);
      continue;
    }
    if (isTreeId(d.id)) {
      let ti = typeIndex.get(d.id);
      if (ti === undefined) {
        const known = TREE_TYPES[d.id];
        ti = treeTypes.length;
        typeIndex.set(d.id, ti);
        treeTypes.push({ typeId: d.id, name: customNames.get(d.id) ?? known?.name ?? d.id, style: known?.style ?? 'other' });
      }
      trees.push([round(d.x, 1), round(d.y, 1), round(d.z, 1), round(d.scaleX, 3), ti, d.variation]);
      treeEntries.push(d);
      continue;
    }
    doodads.push({
      typeId: d.id,
      x: round(d.x, 1),
      y: round(d.y, 1),
      z: round(d.z, 1),
      facing: round(d.angle, 4),
      scale: round(d.scaleX, 3),
    });
  }
  return { treeTypes, trees, doodads, treeEntries, pathingBlockers };
};
