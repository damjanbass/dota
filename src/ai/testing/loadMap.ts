// Node-only helper for tests: loads the extracted DotA 6.83d map from public/data (no fetch).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedMap, MapData } from '../../core/map';

const DATA = fileURLToPath(new URL('../../../public/data/', import.meta.url));

const bytes = (file: string): ArrayBuffer => new Uint8Array(readFileSync(join(DATA, file))).buffer;

let cached: LoadedMap | null = null;

/** The real extracted map (cached per process). */
export const loadRealMap = (): LoadedMap => {
  if (cached) return cached;
  const data = JSON.parse(readFileSync(join(DATA, 'map.json'), 'utf8')) as MapData;
  cached = {
    data,
    height: new Float32Array(bytes(data.files.height)),
    water: new Float32Array(bytes(data.files.water)),
    texture: new Uint8Array(bytes(data.files.texture)),
    cliffLayer: new Uint8Array(bytes(data.files.cliffLayer)),
    tileFlags: new Uint8Array(bytes(data.files.tileFlags)),
    pathing: new Uint8Array(bytes(data.files.pathing)),
  };
  return cached;
};
