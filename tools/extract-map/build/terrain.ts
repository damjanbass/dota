// w3e tilepoints → the per-tilepoint binaries of the MapData contract.
import { TileFlag } from '../../../src/core/map';
import type { MapData } from '../../../src/core/map';
import { groundZ, waterZ } from '../formats/w3e';
import type { W3e } from '../formats/w3e';

export interface TerrainBuild {
  info: MapData['terrain'];
  height: Float32Array;
  water: Float32Array;
  texture: Uint8Array;
  cliffLayer: Uint8Array;
  tileFlags: Uint8Array;
}

export const TILE_SIZE = 128;

export const buildTerrain = (w3e: W3e): TerrainBuild => {
  const n = w3e.cols * w3e.rows;
  const height = new Float32Array(n);
  const water = new Float32Array(n);
  const tileFlags = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    height[i] = groundZ(w3e.groundHeight[i]!, w3e.layerHeight[i]!);
    const f = w3e.flags[i]!;
    // w3e flag nibble order (ramp, blight, water, boundary) is exactly our TileFlag bit order.
    let flags = f & (TileFlag.Ramp | TileFlag.Blight | TileFlag.Water | TileFlag.Boundary);
    if (w3e.mapEdge[i]) flags |= TileFlag.Boundary;
    tileFlags[i] = flags;
    water[i] = f & TileFlag.Water ? waterZ(w3e.waterLevel[i]!) : NaN;
  }
  return {
    info: {
      cols: w3e.cols,
      rows: w3e.rows,
      originX: w3e.originX,
      originY: w3e.originY,
      cellSize: TILE_SIZE,
      groundTextures: w3e.groundTiles,
      tileset: w3e.tileset,
    },
    height,
    water,
    texture: w3e.groundTexture.slice(),
    cliffLayer: w3e.layerHeight.slice(),
    tileFlags,
  };
};
