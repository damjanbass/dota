// war3map.w3e (environment / terrain), format version 11.
// Spec: "W3X/W3M file format" (Zepir & PitzerMike, wc3c.net, mirrored on hiveworkshop.com) and
// mdx-m3-viewer src/parsers/w3x/w3e/{file,corner}.ts; height formulas match HiveWE terrain.cpp.
//
// Header: 'W3E!' | i32 version | char tileset | i32 customTilesets | i32 n + n×char[4] ground tiles |
//         i32 m + m×char[4] cliff tiles | i32 width | i32 height (tilepoints = tiles + 1) |
//         f32 centerOffsetX | f32 centerOffsetY (world coords of tilepoint (0,0), the south-west corner).
// Then width×height tilepoints of 7 bytes, row-major, row 0 = south:
//   i16 groundHeight | u16 waterLevel (bits 0..13) + mapEdge flag (0x4000) |
//   u8 flags (high nibble: 0x10 ramp, 0x20 blight, 0x40 water, 0x80 boundary) + ground texture (low nibble) |
//   u8 variation (cliff variation <<5 | ground variation) | u8 cliff texture (high nibble) + layer height (low nibble)
import { BinaryReader } from './reader';

export interface W3e {
  version: number;
  tileset: string;
  groundTiles: string[];
  cliffTiles: string[];
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  groundHeight: Int16Array;
  waterLevel: Uint16Array;
  mapEdge: Uint8Array;
  /** High-nibble flag bits shifted down: 1 ramp, 2 blight, 4 water, 8 boundary. */
  flags: Uint8Array;
  groundTexture: Uint8Array;
  cliffTexture: Uint8Array;
  layerHeight: Uint8Array;
}

export const parseW3e = (bytes: Uint8Array): W3e => {
  const r = new BinaryReader(bytes);
  if (r.chars(4) !== 'W3E!') throw new Error('war3map.w3e: bad magic');
  const version = r.i32();
  const tileset = r.chars(1);
  r.i32(); // custom tilesets flag
  const groundTiles = Array.from({ length: r.i32() }, () => r.chars(4));
  const cliffTiles = Array.from({ length: r.i32() }, () => r.chars(4));
  const cols = r.i32();
  const rows = r.i32();
  const originX = r.f32();
  const originY = r.f32();
  const n = cols * rows;
  if (r.remaining < n * 7) throw new Error(`war3map.w3e: truncated (${r.remaining} < ${n * 7})`);
  const out: W3e = {
    version,
    tileset,
    groundTiles,
    cliffTiles,
    cols,
    rows,
    originX,
    originY,
    groundHeight: new Int16Array(n),
    waterLevel: new Uint16Array(n),
    mapEdge: new Uint8Array(n),
    flags: new Uint8Array(n),
    groundTexture: new Uint8Array(n),
    cliffTexture: new Uint8Array(n),
    layerHeight: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.groundHeight[i] = r.i16();
    const water = r.u16();
    out.waterLevel[i] = water & 0x3fff;
    out.mapEdge[i] = water & 0x4000 ? 1 : 0;
    const tf = r.u8();
    out.groundTexture[i] = tf & 0x0f;
    out.flags[i] = tf >> 4;
    r.u8(); // variations
    const cl = r.u8();
    out.cliffTexture[i] = cl >> 4;
    out.layerHeight[i] = cl & 0x0f;
  }
  return out;
};

/** Final ground Z in world units: (groundHeight − 0x2000 + (layerHeight − 2) × 0x200) / 4. */
export const groundZ = (groundHeight: number, layerHeight: number): number =>
  (groundHeight - 0x2000 + (layerHeight - 2) * 0x200) / 4;

/**
 * Water surface Z: (waterLevel − 0x2000) / 4 + tileset water offset. WC3's Water.slk gives every
 * standard water type a height of −0.7 (× 128 = −89.6 world units); mdx-m3-viewer and HiveWE apply
 * the same offset.
 */
export const WATER_Z_OFFSET = -89.6;
export const waterZ = (waterLevel: number): number => (waterLevel - 0x2000) / 4 + WATER_Z_OFFSET;
