// npm run extract [path/to/map.w3x]
// Reads a WC3 map (default: the DotA v6.83d source map) and writes public/data/map.json + binaries
// matching the MapData / LoadedMap contract in src/core/map.ts. Geometry and placement only: no
// models, textures, sounds or scripts are copied out of the archive.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedMap, MapData, MapEntityKind } from '../../src/core/map';
import type { Lane, Team } from '../../src/core/types';
import { buildDoodads } from './build/doodads';
import { buildEntities } from './build/entities';
import { NavGrid } from './build/nav';
import { PATH_CELL, stampTrees, translateWpm, treeSpacingReport } from './build/pathing';
import { buildTerrain } from './build/terrain';
import { renderDebugPng } from './debug/render';
import { parseDoo } from './formats/doo';
import { parseScript } from './formats/jass';
import { modValue, parseObjectData } from './formats/objectData';
import { parseProfileKey, parseSlk } from './formats/profile';
import type { SlkTable } from './formats/profile';
import { parseW3e } from './formats/w3e';
import { parseW3i } from './formats/w3i';
import { parseWpm } from './formats/wpm';
import { MpqArchive } from './mpq/archive';

const DEFAULT_MAP = 'D:\\Projekti Vibe Code\\Dota\\source-map\\DotA v6.83d.w3x';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DATA = join(ROOT, 'public', 'data');
const OUT_DEBUG = join(ROOT, 'tools', 'extract-map', 'out');

const FILES: MapData['files'] = {
  height: 'height.bin',
  water: 'water.bin',
  texture: 'texture.bin',
  cliffLayer: 'cliff.bin',
  tileFlags: 'tileflags.bin',
  pathing: 'pathing.bin',
};

const latin1 = new TextDecoder('latin1');

const main = (): void => {
  const mapPath = process.argv[2] ?? DEFAULT_MAP;
  if (!existsSync(mapPath)) throw new Error(`Map not found: ${mapPath}`);
  const archive = new MpqArchive(new Uint8Array(readFileSync(mapPath)));
  const need = (name: string): Uint8Array => {
    const f = archive.read(name);
    if (!f) throw new Error(`${name} not found in ${basename(mapPath)}`);
    return f;
  };
  const text = (name: string): string | undefined => {
    const f = archive.read(name);
    return f && latin1.decode(f);
  };

  // --- object names (optimized maps keep them in Units\*Strings.txt, normal maps in w3u) ----
  const names = parseProfileKey(
    ['Campaign', 'Human', 'NightElf', 'Orc', 'Undead', 'Neutral']
      .map((race) => text(`Units\\${race}UnitStrings.txt`))
      .filter((t): t is string => t !== undefined),
    'Name',
  );
  const w3u = archive.read('war3map.w3u');
  if (w3u) for (const e of parseObjectData(w3u, false)) {
    const n = modValue(e, 'unam');
    if (typeof n === 'string') names.set(e.id, n);
  }
  const destructableNames = new Map<string, string>();
  const w3b = archive.read('war3map.w3b');
  if (w3b) for (const e of parseObjectData(w3b, false)) {
    const n = modValue(e, 'bnam');
    if (typeof n === 'string') destructableNames.set(e.id, n);
  }
  const slk = (name: string): SlkTable => {
    const t = text(name);
    return t ? parseSlk(t) : new Map();
  };

  // --- terrain, doodads, pathing -------------------------------------------------------------
  const w3e = parseW3e(need('war3map.w3e'));
  const terrain = buildTerrain(w3e);
  const wpm = parseWpm(need('war3map.wpm'));
  const expectedCols = (w3e.cols - 1) * 4;
  if (wpm.cols !== expectedCols || wpm.rows !== (w3e.rows - 1) * 4) {
    throw new Error(`wpm ${wpm.cols}×${wpm.rows} does not match terrain (${expectedCols}×${(w3e.rows - 1) * 4})`);
  }
  const pathingInfo = { cols: wpm.cols, rows: wpm.rows, originX: w3e.originX, originY: w3e.originY, cellSize: PATH_CELL };
  const pathing = translateWpm(wpm);
  const doo = parseDoo(need('war3map.doo'));
  const doodads = buildDoodads(doo.doodads, destructableNames);
  const treeCells = stampTrees(pathing, pathingInfo, doodads.treeEntries);

  const w3i = parseW3i(need('war3map.w3i'));
  const [left, , bottom] = w3i.cameraComplements as [number, number, number, number];
  const minX = w3e.originX + left * terrain.info.cellSize;
  const minY = w3e.originY + bottom * terrain.info.cellSize;
  const bounds = {
    minX,
    minY,
    maxX: minX + w3i.playableWidth * terrain.info.cellSize,
    maxY: minY + w3i.playableHeight * terrain.info.cellSize,
  };

  const data: MapData = {
    version: 1,
    source: basename(mapPath),
    bounds,
    terrain: terrain.info,
    pathing: pathingInfo,
    files: FILES,
    treeTypes: doodads.treeTypes,
    trees: doodads.trees,
    doodads: doodads.doodads,
    entities: [],
    lanes: { top: [], mid: [], bot: [] },
  };
  const map: LoadedMap = {
    data,
    height: terrain.height,
    water: terrain.water,
    texture: terrain.texture,
    cliffLayer: terrain.cliffLayer,
    tileFlags: terrain.tileFlags,
    pathing,
  };

  // --- script: units, lanes, camps, runes ----------------------------------------------------
  const script = text('war3map.j') ?? text('scripts\\war3map.j');
  if (!script) throw new Error('war3map.j not found');
  const facts = parseScript(script);
  const nav = new NavGrid(pathing, pathingInfo);
  const built = buildEntities({
    facts,
    names,
    balance: slk('Units\\UnitBalance.slk'),
    weapons: slk('Units\\UnitWeapons.slk'),
    map,
    nav,
  });
  data.entities = built.entities;
  data.lanes = built.lanes;

  // --- write -------------------------------------------------------------------------------
  mkdirSync(OUT_DATA, { recursive: true });
  mkdirSync(OUT_DEBUG, { recursive: true });
  writeFileSync(join(OUT_DATA, 'map.json'), JSON.stringify(data));
  const bin = (a: Float32Array | Uint8Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  writeFileSync(join(OUT_DATA, FILES.height), bin(map.height));
  writeFileSync(join(OUT_DATA, FILES.water), bin(map.water));
  writeFileSync(join(OUT_DATA, FILES.texture), bin(map.texture));
  writeFileSync(join(OUT_DATA, FILES.cliffLayer), bin(map.cliffLayer));
  writeFileSync(join(OUT_DATA, FILES.tileFlags), bin(map.tileFlags));
  writeFileSync(join(OUT_DATA, FILES.pathing), bin(map.pathing));
  writeFileSync(join(OUT_DEBUG, 'debug.png'), renderDebugPng(map));

  // --- summary -----------------------------------------------------------------------------
  const log = (s = ''): void => console.log(s);
  log(`Extracted ${data.source} (MPQ header at 0x${archive.headerOffset.toString(16)}, sector ${archive.sectorSize} bytes)`);
  log(`  terrain  ${terrain.info.cols}×${terrain.info.rows} tilepoints, origin (${terrain.info.originX}, ${terrain.info.originY}), tileset ${terrain.info.tileset}, ${terrain.info.groundTextures.length} ground textures`);
  log(`  pathing  ${pathingInfo.cols}×${pathingInfo.rows} cells of ${PATH_CELL}, ${treeCells} tree-cell stamps`);
  log(`  bounds   x ${bounds.minX}..${bounds.maxX}, y ${bounds.minY}..${bounds.maxY} (playable area; camera bounds ${w3i.cameraBounds.slice(0, 4).join(', ')})`);
  log(`  trees    ${data.trees.length} (${data.treeTypes.map((t, i) => `${t.typeId} ${t.style}: ${data.trees.filter((tr) => tr[4] === i).length}`).join(', ')})`);
  const spacing = [...treeSpacingReport(doodads.treeEntries)].sort((a, b) => b[1] - a[1]).slice(0, 4);
  log(`           nearest-neighbour spacing ${spacing.map(([d, n]) => `${d}u×${n}`).join(', ')} → ${TREE_FOOTPRINT_LABEL}`);
  log(`  doodads  ${data.doodads.length} decorative, ${doodads.pathingBlockers.length} pathing blockers skipped (${[...new Set(doodads.pathingBlockers.map((d) => d.id))].join(', ')})`);
  const kinds = [...new Set(data.entities.map((e) => e.kind))] as MapEntityKind[];
  const count = (kind: MapEntityKind, team: Team): number => data.entities.filter((e) => e.kind === kind && e.team === team).length;
  log(`  entities ${data.entities.length}`);
  for (const k of kinds) log(`    ${k.padEnd(16)} sentinel ${count(k, 'sentinel')}  scourge ${count(k, 'scourge')}  neutral ${count(k, 'neutral')}`);
  for (const lane of ['top', 'mid', 'bot'] as Lane[]) {
    const towers = data.entities.filter((e) => e.kind === 'tower' && e.lane === lane);
    log(`  lane ${lane.padEnd(3)} ${data.lanes[lane].length} waypoints, towers ${towers.map((t) => `${t.team[1]}${t.tier}`).join(' ')}`);
  }
  log(`  unclassified (kind 'other'): ${[...built.unclassified].map(([n, c]) => `${n.trim()} ×${c}`).join(', ') || 'none'}`);
  const problems = [...built.warnings, ...validate(data)];
  log(problems.length ? `  WARNINGS:\n${problems.map((p) => `    - ${p}`).join('\n')}` : '  no warnings');
  log(`Wrote ${OUT_DATA} and ${join(OUT_DEBUG, 'debug.png')}`);
};

const TREE_FOOTPRINT_LABEL = '4×4-cell tree footprints';

const validate = (data: MapData): string[] => {
  const out: string[] = [];
  const expect = (kind: MapEntityKind, team: Team, n: number): void => {
    const got = data.entities.filter((e) => e.kind === kind && e.team === team).length;
    if (got !== n) out.push(`${team} ${kind}: ${got} (expected ${n})`);
  };
  for (const team of ['sentinel', 'scourge'] as const) {
    expect('tower', team, 11);
    expect('barracks_melee', team, 3);
    expect('barracks_ranged', team, 3);
    expect('ancient', team, 1);
    expect('fountain', team, 1);
  }
  expect('roshan', 'neutral', 1);
  expect('rune_spot', 'neutral', 2);
  for (const e of data.entities) {
    const b = data.bounds;
    if (e.x < b.minX || e.x > b.maxX || e.y < b.minY || e.y > b.maxY) out.push(`${e.name} outside bounds`);
  }
  return out;
};

main();
