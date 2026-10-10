// Validates the extracted DotA 6.83d map in public/data against the MapData contract.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entitiesOfKind, isWalkable, waterHeightAt } from '../../src/core/map';
import type { LoadedMap, MapData } from '../../src/core/map';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));

const bytes = (file: string): ArrayBuffer => new Uint8Array(readFileSync(join(DATA, file))).buffer;

const loadExtracted = (): LoadedMap => {
  const data = JSON.parse(readFileSync(join(DATA, 'map.json'), 'utf8')) as MapData;
  return {
    data,
    height: new Float32Array(bytes(data.files.height)),
    water: new Float32Array(bytes(data.files.water)),
    texture: new Uint8Array(bytes(data.files.texture)),
    cliffLayer: new Uint8Array(bytes(data.files.cliffLayer)),
    tileFlags: new Uint8Array(bytes(data.files.tileFlags)),
    pathing: new Uint8Array(bytes(data.files.pathing)),
  };
};

describe('extracted DotA 6.83d map (public/data, from npm run extract)', () => {
  const map = loadExtracted();
  const { data } = map;

  it('binary sizes match the grids', () => {
    const t = data.terrain.cols * data.terrain.rows;
    expect(map.height.length).toBe(t);
    expect(map.water.length).toBe(t);
    expect(map.texture.length).toBe(t);
    expect(map.cliffLayer.length).toBe(t);
    expect(map.tileFlags.length).toBe(t);
    expect(map.pathing.length).toBe(data.pathing.cols * data.pathing.rows);
    expect(data.pathing.cols * data.pathing.cellSize).toBe((data.terrain.cols - 1) * data.terrain.cellSize);
    for (const i of map.texture) expect(i).toBeLessThan(data.terrain.groundTextures.length);
  });

  it('has DotA building counts per side', () => {
    for (const team of ['sentinel', 'scourge'] as const) {
      expect(entitiesOfKind(map, 'tower', team)).toHaveLength(11);
      expect(entitiesOfKind(map, 'barracks_melee', team)).toHaveLength(3);
      expect(entitiesOfKind(map, 'barracks_ranged', team)).toHaveLength(3);
      expect(entitiesOfKind(map, 'ancient', team)).toHaveLength(1);
      expect(entitiesOfKind(map, 'fountain', team)).toHaveLength(1);
    }
  });

  it('gives every tower a tier and every tier 1-3 tower a lane', () => {
    for (const team of ['sentinel', 'scourge'] as const) {
      const towers = entitiesOfKind(map, 'tower', team);
      for (const t of towers) {
        expect(t.tier).toBeDefined();
        if (t.tier !== 4) expect(t.lane).toBeDefined();
      }
      expect(towers.filter((t) => t.tier === 4)).toHaveLength(2);
      for (const lane of ['top', 'mid', 'bot'] as const) {
        const tiers = towers.filter((t) => t.lane === lane).map((t) => t.tier).sort();
        expect(tiers).toEqual([1, 2, 3]);
      }
    }
  });

  it('has one melee and one ranged barracks per lane per side', () => {
    for (const team of ['sentinel', 'scourge'] as const) {
      for (const kind of ['barracks_melee', 'barracks_ranged'] as const) {
        expect(entitiesOfKind(map, kind, team).map((b) => b.lane).sort()).toEqual(['bot', 'mid', 'top']);
      }
    }
  });

  it('has Roshan, 2 rune spots and neutral camps', () => {
    expect(entitiesOfKind(map, 'roshan')).toHaveLength(1);
    expect(entitiesOfKind(map, 'rune_spot')).toHaveLength(2);
    const camps = entitiesOfKind(map, 'neutral_camp');
    expect(camps.length).toBeGreaterThan(0);
    for (const c of camps) expect(['small', 'medium', 'large', 'ancient']).toContain(c.meta?.size);
    // Runes spawn in the river.
    for (const r of entitiesOfKind(map, 'rune_spot')) expect(Number.isNaN(waterHeightAt(map, r.x, r.y))).toBe(false);
  });

  it('has walkable lane waypoints ordered Sentinel → Scourge', () => {
    const [sentinel] = entitiesOfKind(map, 'ancient', 'sentinel');
    const [scourge] = entitiesOfKind(map, 'ancient', 'scourge');
    for (const lane of ['top', 'mid', 'bot'] as const) {
      const pts = data.lanes[lane];
      expect(pts.length).toBeGreaterThanOrEqual(3);
      for (const p of pts) expect(isWalkable(map, p.x, p.y)).toBe(true);
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      expect(Math.hypot(first.x - sentinel!.x, first.y - sentinel!.y)).toBeLessThan(Math.hypot(first.x - scourge!.x, first.y - scourge!.y));
      expect(Math.hypot(last.x - scourge!.x, last.y - scourge!.y)).toBeLessThan(Math.hypot(last.x - sentinel!.x, last.y - sentinel!.y));
    }
    for (const s of entitiesOfKind(map, 'creep_spawn')) expect(s.lane).toBeDefined();
  });

  it('keeps all entities inside bounds', () => {
    const b = data.bounds;
    for (const e of data.entities) {
      expect(e.x).toBeGreaterThanOrEqual(b.minX);
      expect(e.x).toBeLessThanOrEqual(b.maxX);
      expect(e.y).toBeGreaterThanOrEqual(b.minY);
      expect(e.y).toBeLessThanOrEqual(b.maxY);
    }
  });

  it('puts the Sentinel Ancient bottom-left of the Scourge Ancient', () => {
    const [s] = entitiesOfKind(map, 'ancient', 'sentinel');
    const [u] = entitiesOfKind(map, 'ancient', 'scourge');
    expect(s!.x).toBeLessThan(u!.x);
    expect(s!.y).toBeLessThan(u!.y);
  });

  it('has trees with valid type indices', () => {
    expect(data.trees.length).toBeGreaterThan(1000);
    for (const t of data.trees) expect(t[4]).toBeLessThan(data.treeTypes.length);
    expect(new Set(data.treeTypes.map((t) => t.style))).toEqual(new Set(['ashenvale', 'northrend']));
  });
});
