// war3map.doo (doodads + destructibles), format version 7/8 (pre-1.32 layout, no skin ids).
// Spec (W3X file format docs, mdx-m3-viewer src/parsers/w3x/doo/{file,doodad}.ts):
//   'W3do' | i32 version | i32 subversion | i32 count | count × doodad | i32 special version | i32 n | n × 16 bytes
// Doodad: char[4] id | i32 variation | f32 x, y, z | f32 angle (radians) | f32 scale x, y, z |
//         u8 flags (0 invisible+non-solid, 1 visible+non-solid, 2 normal) | u8 life % |
//         [v8+: i32 item table | i32 n sets | sets…] | i32 editor id
import { BinaryReader } from './reader';

export interface DooEntry {
  id: string;
  variation: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  flags: number;
  life: number;
  editorId: number;
}

export interface Doo {
  version: number;
  subversion: number;
  doodads: DooEntry[];
}

export const parseDoo = (bytes: Uint8Array): Doo => {
  const r = new BinaryReader(bytes);
  if (r.chars(4) !== 'W3do') throw new Error('war3map.doo: bad magic');
  const version = r.i32();
  const subversion = r.i32();
  const count = r.i32();
  const doodads: DooEntry[] = [];
  for (let i = 0; i < count; i++) {
    const id = r.chars(4);
    const variation = r.i32();
    const x = r.f32();
    const y = r.f32();
    const z = r.f32();
    const angle = r.f32();
    const scaleX = r.f32();
    const scaleY = r.f32();
    const scaleZ = r.f32();
    const flags = r.u8();
    const life = r.u8();
    if (version >= 8) {
      r.i32(); // item table
      for (let s = 0, sets = r.i32(); s < sets; s++) r.skip(r.i32() * 8);
    }
    const editorId = r.i32();
    doodads.push({ id, variation, x, y, z, angle, scaleX, scaleY, scaleZ, flags, life, editorId });
  }
  return { version, subversion, doodads };
};
