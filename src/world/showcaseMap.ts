// Dev-only LoadedMap for ?view=showcase: flat ground at an ABSOLUTE height (like the real map),
// Ashenvale grass on the west half, blighted Northrend dirt on the east, a dirt strip for the
// unit lineup, a pond, a cliff plateau with a ramp, a tree line of every tree kind, sample
// doodads, and every building kind placed as an entity.
import { TileFlag } from '../core/map';
import type { LoadedMap, MapData, MapEntity, MapEntityKind } from '../core/map';
import type { Team, Tier } from '../core/types';
import { fbm, makeRand } from './noise';

export const SHOWCASE_GROUND = 1024;
const TILES = 112;
const TILE = 128;
const HALF = (TILES * TILE) / 2;
const COLS = TILES + 1;

/** Rows (WC3 y) of the lineup. */
export const SHOWCASE_ROWS = { units: 600, unitsBack: 860, middle: 1800, back: 3100 } as const;

const POND = { x: -3900, y: 300, r: 760 };
const PLATEAU = { x0: 2900, x1: 5200, y0: 3900, y1: 5000, rampX0: 2400 };

export const createShowcaseMap = (): LoadedMap => {
  const rand = makeRand(99);
  const n = COLS * COLS;
  const height = new Float32Array(n);
  const water = new Float32Array(n).fill(NaN);
  const texture = new Uint8Array(n);
  const cliffLayer = new Uint8Array(n).fill(10);
  const tileFlags = new Uint8Array(n);
  for (let iy = 0; iy < COLS; iy++) {
    for (let ix = 0; ix < COLS; ix++) {
      const i = iy * COLS + ix;
      const x = -HALF + ix * TILE;
      const y = -HALF + iy * TILE;
      let h = SHOWCASE_GROUND + (fbm(x / 1400, y / 1400, 3, 5) - 0.5) * 24;
      const east = x + (fbm(x / 900, y / 900, 3, 9) - 0.5) * 900 > 300;
      let tex = east ? 5 : fbm(x / 700, y / 700, 2, 3) > 0.55 ? 2 : 0;
      if (Math.abs(y - (SHOWCASE_ROWS.units + 120)) < 420 || Math.abs(y - SHOWCASE_ROWS.middle) < 260) tex = 1;
      // Pond.
      const pd = Math.hypot(x - POND.x, y - POND.y);
      if (pd < POND.r + 140) {
        const k = Math.max(0, 1 - pd / POND.r);
        h -= 110 * Math.min(1, k * 1.6);
        if (pd < POND.r) tex = 3;
        water[i] = SHOWCASE_GROUND - 40;
      }
      // Cliff plateau (+1 layer) with a ramp on its west side.
      let layer = 10;
      let flags = 0;
      if (y >= PLATEAU.y0 && y <= PLATEAU.y1) {
        if (x >= PLATEAU.x0 && x <= PLATEAU.x1) {
          layer = 11;
          h += 128;
          tex = 6;
        } else if (x >= PLATEAU.rampX0 && x < PLATEAU.x0 && y <= PLATEAU.y0 + 500) {
          h += 128 * ((x - PLATEAU.rampX0) / (PLATEAU.x0 - PLATEAU.rampX0));
          flags |= TileFlag.Ramp;
          tex = 1;
        }
      }
      if (east && pd > POND.r) flags |= TileFlag.Blight;
      if (!Number.isNaN(water[i]!)) flags |= TileFlag.Water;
      if (ix < 2 || iy < 2 || ix > COLS - 3 || iy > COLS - 3) flags |= TileFlag.Boundary;
      height[i] = h;
      texture[i] = tex;
      cliffLayer[i] = layer;
      tileFlags[i] = flags;
    }
  }

  const entities: MapEntity[] = [];
  const add = (kind: MapEntityKind, team: Team, x: number, y: number, name: string = kind, tier?: Tier): void => {
    entities.push({ id: entities.length + 1, kind, team, x, y, z: SHOWCASE_GROUND, facing: (3 * Math.PI) / 2, typeId: '', name, tier });
  };
  const mid: Array<[MapEntityKind, Team, Tier?]> = [
    ['tower', 'sentinel', 1],
    ['tower', 'sentinel', 2],
    ['tower', 'sentinel', 3],
    ['tower', 'sentinel', 4],
    ['barracks_melee', 'sentinel'],
    ['barracks_ranged', 'sentinel'],
    ['barracks_melee', 'scourge'],
    ['barracks_ranged', 'scourge'],
    ['tower', 'scourge', 1],
    ['tower', 'scourge', 2],
    ['tower', 'scourge', 3],
    ['tower', 'scourge', 4],
  ];
  mid.forEach(([kind, team, tier], i) => add(kind, team, -2750 + i * 500, SHOWCASE_ROWS.middle, kind, tier));
  const back: Array<[MapEntityKind, Team, string, number]> = [
    ['ancient', 'sentinel', 'The World Tree', -5000],
    ['fountain', 'sentinel', 'Fountain', -3900],
    ['shop', 'sentinel', 'Shop', -3150],
    ['secret_shop', 'neutral', 'Secret Shop', -2450],
    ['side_shop', 'neutral', 'Side Shop', -1750],
    ['tavern', 'neutral', 'Tavern', -1000],
    ['roshan', 'neutral', 'Roshan', -100],
    ['other', 'sentinel', 'Moon Well', 700],
    ['other', 'scourge', 'Ziggurat', 1250],
    ['other', 'sentinel', 'Circle of Power', 1800],
    ['shop', 'scourge', 'Shop', 2450],
    ['fountain', 'scourge', 'Fountain', 3250],
    ['ancient', 'scourge', 'The Frozen Throne', 4500],
  ];
  for (const [kind, team, name, x] of back) add(kind, team, x, SHOWCASE_ROWS.back, name);

  // Tree line (all four kinds) + a few clumps.
  const trees: MapData['trees'] = [];
  for (let k = 0; k < 900; k++) {
    const x = -HALF + 500 + rand() * (HALF * 2 - 1000);
    const y = 5300 + rand() * 1200;
    const type = x < -2600 ? 0 : x < 0 ? 2 : x < 2600 ? 0 : 1;
    trees.push([x, y, SHOWCASE_GROUND, 0.85 + rand() * 0.35, type, (rand() * 10) | 0]);
  }
  for (let k = 0; k < 260; k++) {
    const side = k % 2 ? 1 : -1;
    const x = side * (5600 + rand() * 1200);
    const y = -2400 + rand() * 7600;
    trees.push([x, y, SHOWCASE_GROUND, 0.85 + rand() * 0.35, side < 0 ? 0 : 1, (rand() * 10) | 0]);
  }

  const doodadIds = ['ARrk', 'ZPsh', 'ZPfw', 'APms', 'LOsk', 'LOic', 'IOst'];
  const doodads: MapData['doodads'] = [];
  doodadIds.forEach((typeId, i) => {
    for (let k = 0; k < 4; k++) {
      doodads.push({ typeId, x: -2400 + i * 260 + rand() * 120, y: -300 + k * 120 + rand() * 60, z: SHOWCASE_GROUND, facing: rand() * 6, scale: 1 });
    }
  });

  const PCOLS = (TILES * TILE) / 32;
  const pathing = new Uint8Array(PCOLS * PCOLS);

  const data: MapData = {
    version: 1,
    source: 'showcase',
    bounds: { minX: -HALF + 256, minY: -HALF + 256, maxX: HALF - 256, maxY: HALF - 256 },
    terrain: {
      cols: COLS,
      rows: COLS,
      originX: -HALF,
      originY: -HALF,
      cellSize: TILE,
      groundTextures: ['Agrs', 'Adrt', 'Agrd', 'Arck', 'Nsnw', 'Ndrt', 'Lgrs'],
      tileset: 'A',
    },
    pathing: { cols: PCOLS, rows: PCOLS, originX: -HALF, originY: -HALF, cellSize: 32 },
    files: { height: '', water: '', texture: '', cliffLayer: '', tileFlags: '', pathing: '' },
    treeTypes: [
      { typeId: 'ATtr', name: 'Ashenvale Tree Wall', style: 'ashenvale' },
      { typeId: 'NTtw', name: 'Northrend Tree Wall', style: 'northrend' },
      { typeId: 'LTlt', name: 'Summer Tree Wall', style: 'other' },
    ],
    trees,
    doodads,
    entities,
    lanes: { top: [], mid: [], bot: [] },
  };
  return { data, height, water, texture, cliffLayer, tileFlags, pathing };
};
