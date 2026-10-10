// war3map.w3i (map info). Only the leading fields up to the playable area are needed.
// Spec (W3X file format docs, mdx-m3-viewer src/parsers/w3x/w3i/file.ts):
//   i32 version | i32 saves | i32 editor version | [v28+: 4×u32 game build] | name | author | description |
//   recommended players (null-terminated strings) | f32[8] camera bounds | i32[4] camera bounds complements |
//   i32 playable width | i32 playable height | u32 flags | char tileset | ...
// Camera bounds are four corners (as passed to SetCameraBounds): (x1,y1) bottom-left, (x2,y2) top-right,
// (x3,y3) top-left, (x4,y4) bottom-right. Complements are the unplayable tile margins (left, right, bottom, top).
import { BinaryReader } from './reader';

export interface W3i {
  version: number;
  name: string;
  cameraBounds: number[];
  cameraComplements: number[];
  playableWidth: number;
  playableHeight: number;
  tileset: string;
}

export const parseW3i = (bytes: Uint8Array): W3i => {
  const r = new BinaryReader(bytes);
  const version = r.i32();
  r.i32(); // saves
  r.i32(); // editor version
  if (version > 27) r.skip(16);
  const name = r.cstring();
  r.cstring(); // author
  r.cstring(); // description
  r.cstring(); // recommended players
  const cameraBounds = Array.from({ length: 8 }, () => r.f32());
  const cameraComplements = Array.from({ length: 4 }, () => r.i32());
  const playableWidth = r.i32();
  const playableHeight = r.i32();
  r.u32(); // flags
  const tileset = r.chars(1);
  return { version, name, cameraBounds, cameraComplements, playableWidth, playableHeight, tileset };
};
