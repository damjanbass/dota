// WC3 object-data modification files (war3map.w3u / w3t / w3b / w3d / w3a / w3h / w3q), format v1/v2.
// Spec (W3X file format docs, mdx-m3-viewer src/parsers/w3x/w3u/*):
//   i32 version | original table | custom table
//   table: i32 n | n × { char[4] baseId | char[4] newId (0000 in the original table) | i32 m | m × mod }
//   mod:   char[4] field | i32 type | [w3d/w3a/w3q only: i32 level/variation | i32 data pointer] | value | char[4] end
//   type: 0 int, 1 real, 2 unreal, 3 string (null-terminated)
import { BinaryReader } from './reader';

export interface ObjectMod {
  field: string;
  level: number;
  value: number | string;
}

export interface ObjectEntry {
  baseId: string;
  /** Equal to baseId for entries in the original table. */
  id: string;
  custom: boolean;
  mods: ObjectMod[];
}

export const parseObjectData = (bytes: Uint8Array, hasLevels: boolean): ObjectEntry[] => {
  const r = new BinaryReader(bytes);
  r.i32(); // version
  const out: ObjectEntry[] = [];
  for (const custom of [false, true]) {
    if (r.remaining < 4) break;
    const n = r.i32();
    for (let i = 0; i < n; i++) {
      const baseId = r.chars(4);
      const newId = r.chars(4);
      const mods: ObjectMod[] = [];
      for (let m = 0, count = r.i32(); m < count; m++) {
        const field = r.chars(4);
        const type = r.i32();
        let level = 0;
        if (hasLevels) {
          level = r.i32();
          r.i32(); // data pointer
        }
        const value = type === 0 ? r.i32() : type === 1 || type === 2 ? r.f32() : r.cstring();
        r.skip(4);
        mods.push({ field, level, value });
      }
      out.push({ baseId, id: custom ? newId : baseId, custom, mods });
    }
  }
  return out;
};

export const modValue = (entry: ObjectEntry | undefined, field: string): number | string | undefined =>
  entry?.mods.find((m) => m.field === field)?.value;
