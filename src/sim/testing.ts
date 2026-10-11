// Node-only helpers for sim tests and benchmarks (not imported by browser code).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedMap, MapData } from '../core/map';
import type { MatchConfig } from '../core/sim';

/** Loads the extracted 6.83d map from public/data (Node). */
export const loadRealMap = (dataDir: string): LoadedMap => {
  const bytes = (file: string): ArrayBuffer => new Uint8Array(readFileSync(join(dataDir, file))).buffer;
  const data = JSON.parse(readFileSync(join(dataDir, 'map.json'), 'utf8')) as MapData;
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

export const testConfig = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  seed: 1,
  playerHero: 'sniper',
  allies: [],
  enemies: [],
  difficulty: 'medium',
  ...over,
});
