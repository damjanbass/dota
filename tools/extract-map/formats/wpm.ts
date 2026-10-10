// war3map.wpm (static pathing map), 4×4 cells per terrain tile (32×32 world units each).
// Spec (W3X file format docs, mdx-m3-viewer src/parsers/w3x/wpm/file.ts):
//   'MP3W' | i32 version (0) | i32 width | i32 height | width×height bytes, row-major, row 0 = south.
// Cell bits: 0x02 no walk, 0x04 no fly, 0x08 no build, 0x20 blight, 0x40 NO water, 0x80 unused.
import { BinaryReader } from './reader';

export const WpmFlag = {
  NoWalk: 0x02,
  NoFly: 0x04,
  NoBuild: 0x08,
  Blight: 0x20,
  NoWater: 0x40,
} as const;

export interface Wpm {
  version: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

export const parseWpm = (bytes: Uint8Array): Wpm => {
  const r = new BinaryReader(bytes);
  if (r.chars(4) !== 'MP3W') throw new Error('war3map.wpm: bad magic');
  const version = r.i32();
  const cols = r.i32();
  const rows = r.i32();
  if (r.remaining < cols * rows) throw new Error('war3map.wpm: truncated');
  return { version, cols, rows, cells: bytes.slice(r.offset, r.offset + cols * rows) };
};
