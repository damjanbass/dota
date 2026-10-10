// WC3 ground tile id → our procedural ground layer. Pure (unit-tested).
// Exact ids first, then fallback by the id's 2nd–4th letters, tinted by tileset letter.

export const GroundLayer = {
  GrassAshen: 0,
  GrassLumpy: 1,
  GrassLord: 2,
  GrassNorth: 3,
  Dirt: 4,
  DirtRough: 5,
  DirtNorth: 6,
  GrassyDirt: 7,
  Rock: 8,
  Snow: 9,
  Ice: 10,
  Leaves: 11,
  Vines: 12,
  Tiles: 13,
  Sand: 14,
  Blight: 15,
  Cliff: 16,
  CliffDark: 17,
  Dark: 18,
} as const;

export type GroundLayerId = (typeof GroundLayer)[keyof typeof GroundLayer];

export const GROUND_LAYER_COUNT = 19;

const L = GroundLayer;

const EXACT: Record<string, GroundLayerId> = {
  // Ashenvale
  Agrs: L.GrassAshen,
  Agrd: L.GrassLumpy,
  Adrt: L.Dirt,
  Adrd: L.DirtRough,
  Adrg: L.GrassyDirt,
  Arck: L.Rock,
  Avin: L.Vines,
  Alvd: L.Leaves,
  // Lordaeron summer / fall / winter
  Lgrs: L.GrassLord,
  Lgrd: L.GrassLumpy,
  Ldrt: L.Dirt,
  Ldro: L.DirtRough,
  Ldrg: L.GrassyDirt,
  Lrok: L.Rock,
  Fgrs: L.GrassLord,
  Fgrd: L.Leaves,
  Fdrt: L.Dirt,
  Fdro: L.DirtRough,
  Fdrg: L.GrassyDirt,
  Frok: L.Rock,
  Wgrs: L.GrassNorth,
  Wsng: L.Snow,
  Wsnw: L.Snow,
  Wdrt: L.DirtNorth,
  Wdro: L.DirtRough,
  Wrok: L.Rock,
  // Northrend / Icecrown
  Ngrs: L.GrassNorth,
  Ndrt: L.DirtNorth,
  Ndrd: L.DirtRough,
  Nrck: L.Rock,
  Nice: L.Ice,
  Nsnw: L.Snow,
  Nsnr: L.Snow,
  Idrt: L.DirtNorth,
  Idtr: L.DirtRough,
  Idki: L.Dark,
  Ibkb: L.Tiles,
  Irbk: L.Tiles,
  Itbk: L.Tiles,
  Iice: L.Ice,
  Ibsq: L.Tiles,
  Isnw: L.Snow,
  // Felwood (poison = blight-like)
  Cpos: L.Blight,
  Cgrs: L.GrassNorth,
  Cvin: L.Vines,
  Clvg: L.Leaves,
  // Barrens
  Bdsr: L.Sand,
  Bdsd: L.Sand,
  Bflr: L.Sand,
  Bdrt: L.Dirt,
  Bdrh: L.DirtRough,
  Bdrr: L.DirtRough,
  Bdrg: L.GrassyDirt,
  Bgrr: L.GrassLord,
  // Cityscape / Dalaran hedges
  Yhdg: L.GrassLumpy,
  Xhdg: L.GrassLumpy,
  Jhdg: L.GrassLumpy,
  Ygsb: L.GrassLord,
  Xgsb: L.GrassLord,
  Jgsb: L.GrassLord,
};

const SUFFIX: Array<[string[], GroundLayerId | 'grass' | 'dirt']> = [
  [['grs', 'grr', 'gsb', 'grt'], 'grass'],
  [['grd', 'hdg'], L.GrassLumpy],
  [['drt', 'dtr'], 'dirt'],
  [['drd', 'dro', 'drr', 'drh'], L.DirtRough],
  [['drg'], L.GrassyDirt],
  [['rck', 'rok', 'roc', 'rk'], L.Rock],
  [['snw', 'snr', 'sng', 'snow'], L.Snow],
  [['ice'], L.Ice],
  [['vin'], L.Vines],
  [['lvd', 'lvg', 'lvs', 'lea'], L.Leaves],
  [
    ['blm', 'btl', 'sqd', 'rtl', 'bks', 'brk', 'til', 'stp', 'cbp', 'crp', 'fsl', 'fst', 'sqt', 'bsq', 'tbk', 'rbk', 'bkb', 'bkl', 'rds', 'wmb'],
    L.Tiles,
  ],
  [['san', 'dsr', 'dsd', 'flr', 'snd'], L.Sand],
  [['pos', 'blt', 'bli'], L.Blight],
  [['lav', 'aby', 'dkr', 'dki', 'dkt', 'lvc', 'smb', 'lgb'], L.Dark],
];

const northern = (tileset: string): boolean => tileset === 'N' || tileset === 'W' || tileset === 'I';

/** Maps a 4-char WC3 ground tile id to a ground layer. */
export const groundLayerForTileId = (id: string): GroundLayerId => {
  const exact = EXACT[id];
  if (exact !== undefined) return exact;
  const ts = id.charAt(0).toUpperCase();
  const rest = id.slice(1).toLowerCase();
  for (const [keys, layer] of SUFFIX) {
    if (keys.some((k) => rest.includes(k))) {
      if (layer === 'grass') return ts === 'A' ? L.GrassAshen : northern(ts) ? L.GrassNorth : L.GrassLord;
      if (layer === 'dirt') return northern(ts) ? L.DirtNorth : L.Dirt;
      return layer;
    }
  }
  return northern(ts) ? L.DirtNorth : L.GrassyDirt;
};

/** Ground-layer lookup for a map's texture list (index = tilepoint texture byte). */
export const groundLayersFor = (groundTextures: readonly string[]): GroundLayerId[] =>
  groundTextures.map(groundLayerForTileId);
