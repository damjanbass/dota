// Visual terrain grid: the tilepoint heightfield subdivided S× per tile, with WC3-style cliffs.
// Where neighbouring cliffLayer values differ (and the tile is not a ramp) the layer step is
// sharpened into a steep wall in the middle third of the tile, then the wall is roughened.
// Pure (no three.js) so it is unit-testable; all coordinates are WC3 (x east, y north, z up).
import { TileFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import { valueNoise } from './noise';

/** WC3 height of one cliff layer. */
export const CLIFF_LAYER_HEIGHT = 128;

export interface TerrainGrid {
  /** Sub-vertices per tile edge. */
  S: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  /** Distance between sub-vertices (tile size / S). */
  step: number;
  /** Displaced WC3 position per sub-vertex. */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** Unit normal (WC3 axes), 3 floats per sub-vertex. */
  normal: Float32Array;
  /** Cavity ambient occlusion 0.5..1. */
  ao: Float32Array;
  /** Cliff-wall factor 0..1. */
  wall: Float32Array;
  /** Water surface Z, NaN where dry. */
  waterZ: Float32Array;
}

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Turns a bilinear cliff-layer value into a terraced one (steps in the middle third). */
export const sharpenLayer = (l: number): number => {
  const f = Math.floor(l);
  return f + smoothstep(0.38, 0.62, l - f);
};

export const buildTerrainGrid = (map: LoadedMap, S = 3): TerrainGrid => {
  const t = map.data.terrain;
  const tc = t.cols;
  const tr = t.rows;
  const cols = (tc - 1) * S + 1;
  const rows = (tr - 1) * S + 1;
  const n = cols * rows;
  const step = t.cellSize / S;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const waterZ = new Float32Array(n);
  const H = map.height;
  const C = map.cliffLayer;
  const F = map.tileFlags;
  const W = map.water;

  for (let gy = 0; gy < rows; gy++) {
    const fy = gy / S;
    const iy = Math.min(Math.floor(fy), tr - 2);
    const ty = fy - iy;
    for (let gx = 0; gx < cols; gx++) {
      const fx = gx / S;
      const ix = Math.min(Math.floor(fx), tc - 2);
      const tx = fx - ix;
      const i00 = iy * tc + ix;
      const i10 = i00 + 1;
      const i01 = i00 + tc;
      const i11 = i01 + 1;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const smoothH = H[i00]! * w00 + H[i10]! * w10 + H[i01]! * w01 + H[i11]! * w11;
      const c00 = C[i00]!;
      const c10 = C[i10]!;
      const c01 = C[i01]!;
      const c11 = C[i11]!;
      let h = smoothH;
      if (c00 !== c10 || c00 !== c01 || c00 !== c11) {
        const layer = c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11;
        const base =
          (H[i00]! - c00 * CLIFF_LAYER_HEIGHT) * w00 +
          (H[i10]! - c10 * CLIFF_LAYER_HEIGHT) * w10 +
          (H[i01]! - c01 * CLIFF_LAYER_HEIGHT) * w01 +
          (H[i11]! - c11 * CLIFF_LAYER_HEIGHT) * w11;
        const sharpH = base + sharpenLayer(layer) * CLIFF_LAYER_HEIGHT;
        const ramp =
          ((F[i00]! & TileFlag.Ramp) ? w00 : 0) +
          ((F[i10]! & TileFlag.Ramp) ? w10 : 0) +
          ((F[i01]! & TileFlag.Ramp) ? w01 : 0) +
          ((F[i11]! & TileFlag.Ramp) ? w11 : 0);
        const rk = Math.min(1, ramp * 2.5);
        h = sharpH + (smoothH - sharpH) * rk;
      }
      const g = gy * cols + gx;
      pz[g] = h;
      px[g] = t.originX + gx * step;
      py[g] = t.originY + gy * step;

      // NaN-aware bilinear water level.
      let ws = 0;
      let wv = 0;
      const addW = (i: number, w: number): void => {
        const v = W[i]!;
        if (!Number.isNaN(v)) {
          ws += w + 1e-4;
          wv += v * (w + 1e-4);
        }
      };
      addW(i00, w00);
      addW(i10, w10);
      addW(i01, w01);
      addW(i11, w11);
      waterZ[g] = ws > 0 ? wv / ws : NaN;
    }
  }

  // Wall factor from local slope, then roughen walls (horizontal + vertical crag noise).
  const wall = new Float32Array(n);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const g = gy * cols + gx;
      const h = pz[g]!;
      let d = 0;
      if (gx > 0) d = Math.max(d, Math.abs(h - pz[g - 1]!));
      if (gx < cols - 1) d = Math.max(d, Math.abs(h - pz[g + 1]!));
      if (gy > 0) d = Math.max(d, Math.abs(h - pz[g - cols]!));
      if (gy < rows - 1) d = Math.max(d, Math.abs(h - pz[g + cols]!));
      wall[g] = smoothstep(1.3, 2.4, d / step);
    }
  }
  const jit = step * 0.33;
  for (let g = 0; g < n; g++) {
    const w = wall[g]!;
    if (w <= 0) continue;
    const gx = g % cols;
    const gy = (g - gx) / cols;
    px[g] = px[g]! + (valueNoise(gx * 0.9, gy * 0.9, 7) - 0.5) * 2 * jit * w;
    py[g] = py[g]! + (valueNoise(gx * 0.9, gy * 0.9, 8) - 0.5) * 2 * jit * w;
    pz[g] = pz[g]! + (valueNoise(gx * 1.7, gy * 1.7, 9) - 0.5) * 22 * w;
  }

  // Normals from displaced positions (central differences).
  const normal = new Float32Array(n * 3);
  for (let gy = 0; gy < rows; gy++) {
    const ya = Math.max(0, gy - 1);
    const yb = Math.min(rows - 1, gy + 1);
    for (let gx = 0; gx < cols; gx++) {
      const xa = Math.max(0, gx - 1);
      const xb = Math.min(cols - 1, gx + 1);
      const a = gy * cols + xa;
      const b = gy * cols + xb;
      const c = ya * cols + gx;
      const d = yb * cols + gx;
      const ux = px[b]! - px[a]!;
      const uy = py[b]! - py[a]!;
      const uz = pz[b]! - pz[a]!;
      const vx = px[d]! - px[c]!;
      const vy = py[d]! - py[c]!;
      const vz = pz[d]! - pz[c]!;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const g = (gy * cols + gx) * 3;
      normal[g] = nx;
      normal[g + 1] = ny;
      normal[g + 2] = nz;
    }
  }

  // Cavity AO: compare with a separable box-blurred height (radius R sub-vertices).
  const R = 4;
  const tmp = new Float32Array(n);
  const blur = new Float32Array(n);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let s = 0;
      let k = 0;
      for (let o = -R; o <= R; o++) {
        const x = gx + o;
        if (x < 0 || x >= cols) continue;
        s += pz[gy * cols + x]!;
        k++;
      }
      tmp[gy * cols + gx] = s / k;
    }
  }
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let s = 0;
      let k = 0;
      for (let o = -R; o <= R; o++) {
        const y = gy + o;
        if (y < 0 || y >= rows) continue;
        s += tmp[y * cols + gx]!;
        k++;
      }
      blur[gy * cols + gx] = s / k;
    }
  }
  const ao = new Float32Array(n);
  for (let g = 0; g < n; g++) {
    const cav = blur[g]! - pz[g]!;
    ao[g] = 1 - Math.min(0.42, Math.max(0, cav) / 110) + Math.min(0.06, Math.max(0, -cav) / 400);
  }

  return { S, cols, rows, originX: t.originX, originY: t.originY, step, px, py, pz, normal, ao, wall, waterZ };
};

/** Bilinear visual ground height (undisplaced lattice) at WC3 (x, y). */
export const gridHeightAt = (g: TerrainGrid, x: number, y: number): number => {
  const fx = Math.min(Math.max((x - g.originX) / g.step, 0), g.cols - 1.0001);
  const fy = Math.min(Math.max((y - g.originY) / g.step, 0), g.rows - 1.0001);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * g.cols + ix;
  const z = g.pz;
  const a = z[i]! + (z[i + 1]! - z[i]!) * tx;
  const b = z[i + g.cols]! + (z[i + g.cols + 1]! - z[i + g.cols]!) * tx;
  return a + (b - a) * ty;
};
