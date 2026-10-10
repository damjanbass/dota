import { describe, expect, it } from 'vitest';
import { createMockMap } from '../../src/core/mockMap';
import { entitiesOfKind, groundHeightAt, isWalkable, waterHeightAt } from '../../src/core/map';

describe('mock map contract', () => {
  const map = createMockMap();

  it('has DotA building counts per side', () => {
    for (const team of ['sentinel', 'scourge'] as const) {
      expect(entitiesOfKind(map, 'tower', team)).toHaveLength(11);
      expect(entitiesOfKind(map, 'barracks_melee', team)).toHaveLength(3);
      expect(entitiesOfKind(map, 'barracks_ranged', team)).toHaveLength(3);
      expect(entitiesOfKind(map, 'ancient', team)).toHaveLength(1);
      expect(entitiesOfKind(map, 'fountain', team)).toHaveLength(1);
    }
    expect(entitiesOfKind(map, 'rune_spot')).toHaveLength(2);
    expect(entitiesOfKind(map, 'roshan')).toHaveLength(1);
  });

  it('grid sizes match the binaries', () => {
    const { terrain, pathing } = map.data;
    expect(map.height.length).toBe(terrain.cols * terrain.rows);
    expect(map.pathing.length).toBe(pathing.cols * pathing.rows);
  });

  it('has a river with water and walkable lanes', () => {
    expect(waterHeightAt(map, 0, 0)).toBeLessThan(0);
    expect(groundHeightAt(map, 0, 0)).toBeLessThan(waterHeightAt(map, 0, 0));
    expect(Number.isNaN(waterHeightAt(map, -4000, -4000))).toBe(true);
    for (const lane of Object.values(map.data.lanes)) {
      for (const p of lane) expect(isWalkable(map, p.x, p.y)).toBe(true);
    }
  });
});
