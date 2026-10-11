import { describe, expect, it } from 'vitest';
import { createMockMap } from '../core/mockMap';
import { doodadKindFor } from './doodads';
import { GroundLayer, groundLayerForTileId } from './groundTiles';
import { buildTerrainGrid, gridHeightAt, sharpenLayer } from './terrainGrid';
import { treeKindFor } from './treeModels';
import { kf } from './unitRig';
import { resolveUnitModelId } from './units';
import { MAP_VIEWS, computeView, isClearSpot } from './views';

describe('ground tile mapping', () => {
  it('maps exact WC3 ids', () => {
    expect(groundLayerForTileId('Agrs')).toBe(GroundLayer.GrassAshen);
    expect(groundLayerForTileId('Adrt')).toBe(GroundLayer.Dirt);
    expect(groundLayerForTileId('Arck')).toBe(GroundLayer.Rock);
    expect(groundLayerForTileId('Nsnw')).toBe(GroundLayer.Snow);
    expect(groundLayerForTileId('Cgrs')).toBe(GroundLayer.GrassAshen);
    expect(groundLayerForTileId('Zbks')).toBe(GroundLayer.Tiles);
  });
  it('falls back by suffix and tileset', () => {
    expect(groundLayerForTileId('Xgrs')).toBe(GroundLayer.GrassLord);
    expect(groundLayerForTileId('Ngrs')).toBe(GroundLayer.GrassNorth);
    expect(groundLayerForTileId('Qdrt')).toBe(GroundLayer.Dirt);
    expect(groundLayerForTileId('Wdrt')).toBe(GroundLayer.DirtNorth);
    expect(groundLayerForTileId('Kzzz')).toBe(GroundLayer.GrassyDirt);
  });
});

describe('terrain grid', () => {
  it('sharpens cliff layers into the middle third', () => {
    expect(sharpenLayer(2)).toBe(2);
    expect(sharpenLayer(2 + 1 / 3)).toBe(2);
    expect(sharpenLayer(2 + 2 / 3)).toBe(3);
  });
  it('matches tilepoint heights on the mock map and has no NaN', () => {
    const map = createMockMap();
    const g = buildTerrainGrid(map, 3);
    const t = map.data.terrain;
    expect(g.cols).toBe((t.cols - 1) * 3 + 1);
    expect(g.pz.every((v) => Number.isFinite(v))).toBe(true);
    const x = t.originX + 40 * t.cellSize;
    const y = t.originY + 30 * t.cellSize;
    expect(gridHeightAt(g, x, y)).toBeCloseTo(map.height[30 * t.cols + 40]!, 3);
  });
});

describe('models and presets', () => {
  it('resolves unit ids and aliases', () => {
    expect(resolveUnitModelId('sentinel_creep_melee')).toBe('treant');
    expect(resolveUnitModelId('scourge_creep_siege')).toBe('meat_wagon');
    expect(resolveUnitModelId('hero_pudge')).toBe('pudge');
    expect(resolveUnitModelId('npc_dota_hero_nevermore')).toBe('shadow_fiend');
    expect(resolveUnitModelId('neutral_kobold_taskmaster')).toBe('kobold');
    expect(resolveUnitModelId('xyz')).toBeNull();
  });
  it('maps tree styles and doodads', () => {
    expect(treeKindFor('ashenvale', false)).toBe('ashen');
    expect(treeKindFor('ashenvale', true)).toBe('twisted');
    expect(treeKindFor('northrend', true)).toBe('pine');
    expect(doodadKindFor('ARrk')).toBe('rock');
    expect(doodadKindFor('ZPsh')).toBe('bush');
    expect(doodadKindFor('D00B')).toBeNull();
    expect(doodadKindFor('LWw0')).toBeNull();
  });
  it('keyframes interpolate and clamp', () => {
    const keys = [[0, 0], [0.5, 1], [1, 0]] as const;
    expect(kf(0, keys)).toBe(0);
    expect(kf(0.5, keys)).toBe(1);
    expect(kf(0.25, keys)).toBeCloseTo(0.5, 5);
    expect(kf(2, keys)).toBe(0);
  });
  it('computes every view preset on the mock map at eye height in a clear spot', () => {
    const map = createMockMap();
    const ground = (x: number, y: number): number => gridHeightAt(buildTerrainGrid(map, 1), x, y);
    for (const v of MAP_VIEWS) {
      const p = computeView(map, v, ground);
      expect(Number.isFinite(p.position.x + p.position.y + p.position.z)).toBe(true);
      expect(p.position.z).toBeGreaterThan(ground(p.position.x, p.position.y));
      expect(Math.hypot(p.target.x - p.position.x, p.target.y - p.position.y)).toBeGreaterThan(100);
      if (v !== 'river') expect(isClearSpot(map, p.position.x, p.position.y)).toBe(true);
    }
  });
});
