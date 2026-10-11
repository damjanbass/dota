// Procedural hand-painted ground textures (one DataArrayTexture layer per GroundLayer) plus a
// tileable RGBA noise texture used to break up tiling and perturb splat transitions.
// Everything is generated at startup — no external images.
import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { GROUND_LAYER_COUNT, GroundLayer } from './groundTiles';
import { fbm, hash2, makeRand } from './noise';

type RGB = readonly [number, number, number];

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

const LOW = 128; // low-res blotch layer, upsampled

interface Painter {
  /** Up to 3 base colours blended by two fbm fields. */
  base: [number, number, number];
  /** fbm frequency (periods across the tile). */
  freq: number;
  /** Fine per-pixel grain amount (0..1). */
  grain: number;
  /** Extra detail strokes. */
  detail?: (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;
  /** Horizontal banding strength (cliff strata). */
  strata?: number;
}

/** Draws `fn` at the 9 wrap offsets that can touch the tile, so strokes tile seamlessly. */
const wrapDraw = (size: number, x: number, y: number, r: number, fn: (ox: number, oy: number) => void): void => {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
      fn(ox, oy);
    }
  }
};

const rgba = (c: RGB, a = 1, k = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

const blades = (cols: number[], count: number, len: number, width: number) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const c = hex(cols[(rand() * cols.length) | 0]!);
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.4;
      const l = len * (0.5 + rand());
      const bend = (rand() - 0.5) * l * 0.6;
      ctx.strokeStyle = rgba(c, 0.55 + rand() * 0.4, 0.85 + rand() * 0.3);
      ctx.lineWidth = width * (0.6 + rand() * 0.8);
      wrapDraw(size, x, y, l, (ox, oy) => {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + bend, y + oy - l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        ctx.stroke();
      });
    }
  };

const pebbles = (cols: number[], count: number, rMin: number, rMax: number, shadow = 0.35) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = rMin + rand() * (rMax - rMin);
      const c = hex(cols[(rand() * cols.length) | 0]!);
      const rot = rand() * Math.PI;
      const sq = 0.55 + rand() * 0.4;
      wrapDraw(size, x, y, r * 1.5, (ox, oy) => {
        ctx.fillStyle = `rgba(0,0,0,${shadow})`;
        ctx.beginPath();
        ctx.ellipse(x + ox + r * 0.18, y + oy + r * 0.25, r, r * sq, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(c, 1, 0.9 + rand() * 0.2);
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * sq, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(c, 0.6, 1.25);
        ctx.beginPath();
        ctx.ellipse(x + ox - r * 0.25, y + oy - r * 0.25, r * 0.45, r * sq * 0.4, rot, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

const cracks = (col: number, count: number, len: number, width: number, alpha = 0.6) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    const c = hex(col);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < count; i++) {
      let x = rand() * size;
      let y = rand() * size;
      let a = rand() * Math.PI * 2;
      const pts: Array<[number, number]> = [[x, y]];
      const steps = 4 + ((rand() * 6) | 0);
      for (let s = 0; s < steps; s++) {
        a += (rand() - 0.5) * 1.3;
        const l = (len / steps) * (0.6 + rand() * 0.8);
        x += Math.cos(a) * l;
        y += Math.sin(a) * l;
        pts.push([x, y]);
      }
      ctx.strokeStyle = rgba(c, alpha);
      ctx.lineWidth = width * (0.6 + rand() * 0.8);
      wrapDraw(size, pts[0]![0], pts[0]![1], len * 1.2, (ox, oy) => {
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px + ox, py + oy) : ctx.lineTo(px + ox, py + oy)));
        ctx.stroke();
      });
    }
  };

const blobs = (cols: number[], count: number, rMin: number, rMax: number, alpha: number) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = rMin + rand() * (rMax - rMin);
      const c = hex(cols[(rand() * cols.length) | 0]!);
      wrapDraw(size, x, y, r, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, rgba(c, alpha));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      });
    }
  };

const leaves = (cols: number[], count: number, size0: number) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = size0 * (0.6 + rand() * 0.8);
      const c = hex(cols[(rand() * cols.length) | 0]!);
      const rot = rand() * Math.PI * 2;
      wrapDraw(size, x, y, r, (ox, oy) => {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(x + ox + 1.5, y + oy + 2, r, r * 0.45, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(c, 0.95, 0.9 + rand() * 0.25);
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.45, rot, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

const slabs = (mortar: number, cols: number[], cells: number) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    const cell = size / cells;
    for (let j = 0; j < cells; j++) {
      const off = (j % 2) * cell * 0.5;
      for (let i = 0; i <= cells; i++) {
        const c = hex(cols[(rand() * cols.length) | 0]!);
        const x = i * cell + off - cell;
        const y = j * cell;
        const k = 0.85 + rand() * 0.3;
        for (const ox of [0, size]) {
          ctx.fillStyle = rgba(c, 0.55, k);
          ctx.fillRect(x + ox + 3, y + 3, cell - 6, cell - 6);
        }
      }
    }
    ctx.strokeStyle = rgba(hex(mortar), 0.9);
    ctx.lineWidth = 4;
    for (let j = 0; j <= cells; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * cell);
      ctx.lineTo(size, j * cell);
      ctx.stroke();
      const off = (j % 2) * cell * 0.5;
      for (let i = 0; i <= cells + 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cell + off - cell, j * cell);
        ctx.lineTo(i * cell + off - cell, (j + 1) * cell);
        ctx.stroke();
      }
    }
  };

const ripples = (col: number, count: number) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => {
    ctx.strokeStyle = rgba(hex(col), 0.25);
    ctx.lineWidth = 3;
    for (let i = 0; i < count; i++) {
      const y = rand() * size;
      const x = rand() * size;
      const l = 40 + rand() * 80;
      wrapDraw(size, x, y, l, (ox, oy) => {
        ctx.beginPath();
        ctx.moveTo(x + ox - l / 2, y + oy);
        ctx.quadraticCurveTo(x + ox, y + oy - 8, x + ox + l / 2, y + oy);
        ctx.stroke();
      });
    }
  };

const seq = (...fns: Array<(ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void>) =>
  (ctx: CanvasRenderingContext2D, size: number, rand: () => number): void => fns.forEach((f) => f(ctx, size, rand));

// Painters scale their stroke counts with texture size via `k` (size/512)^2 inside makeLayer.
const PAINTERS: Record<number, Painter> = {
  [GroundLayer.GrassAshen]: {
    base: [0x2f6a34, 0x4f9445, 0x3c7f4a],
    freq: 3,
    grain: 0.1,
    detail: seq(
      blobs([0x24502c, 0x67a84f], 26, 30, 70, 0.35),
      blades([0x5fa84a, 0x2c6034, 0x78bb58, 0x3d8a4e], 2600, 9, 2.2),
      leaves([0x8fcf6a, 0x4a9a5a], 50, 3),
    ),
  },
  [GroundLayer.GrassLumpy]: {
    base: [0x285a2e, 0x427f3c, 0x356f45],
    freq: 4,
    grain: 0.12,
    detail: seq(
      blobs([0x1d4425, 0x5a9a48], 40, 20, 50, 0.45),
      blades([0x4f9640, 0x24502b, 0x6aa84f], 2600, 10, 2.4),
      pebbles([0x6f8a5a], 12, 3, 6, 0.3),
    ),
  },
  [GroundLayer.GrassLord]: {
    base: [0x5a8a2e, 0x7ca63e, 0x6a9a3a],
    freq: 3,
    grain: 0.1,
    detail: seq(
      blobs([0x4a7a26, 0x9abf55], 24, 30, 70, 0.35),
      blades([0x8ebb4c, 0x4f7f2a, 0xa6c860], 2600, 9, 2.2),
      leaves([0xe8e0a0, 0xd8a0d0], 25, 2),
    ),
  },
  [GroundLayer.GrassNorth]: {
    base: [0x3d5848, 0x557060, 0x4a6658],
    freq: 3,
    grain: 0.12,
    detail: seq(
      blades([0x6a8a72, 0x2f4a3c, 0x7f9a86], 2000, 8, 2),
      blobs([0xd8e4ee], 30, 10, 30, 0.35),
    ),
  },
  [GroundLayer.Dirt]: {
    base: [0x6e4f33, 0x8a6843, 0x7b5a3a],
    freq: 3,
    grain: 0.14,
    detail: seq(
      blobs([0x5a3f28, 0x9c7a50], 30, 20, 60, 0.35),
      pebbles([0x9a8062, 0x7d6a55, 0xb09474], 120, 2, 6, 0.3),
      cracks(0x4a3420, 10, 60, 1.5, 0.35),
    ),
  },
  [GroundLayer.DirtRough]: {
    base: [0x5e4430, 0x7a5c3e, 0x6a5038],
    freq: 4,
    grain: 0.16,
    detail: seq(
      blobs([0x47321f, 0x8d7050], 30, 20, 50, 0.4),
      pebbles([0x8f8070, 0x766656, 0xa89a86], 220, 3, 10, 0.4),
    ),
  },
  [GroundLayer.DirtNorth]: {
    base: [0x5f5751, 0x7a716a, 0x6a625c],
    freq: 3,
    grain: 0.14,
    detail: seq(
      pebbles([0x8a8888, 0x6a6a70, 0x9a9aa2], 140, 2, 7, 0.35),
      blobs([0xc8d4e0], 20, 10, 30, 0.25),
    ),
  },
  [GroundLayer.GrassyDirt]: {
    base: [0x6e5434, 0x7f6a3e, 0x5c6a34],
    freq: 3,
    grain: 0.14,
    detail: seq(
      pebbles([0x9a8062, 0x7d6a55], 80, 2, 5, 0.3),
      blobs([0x4f7a33, 0x3d6a2e], 40, 15, 35, 0.6),
      blades([0x6a9a42, 0x40702f], 1200, 8, 2),
    ),
  },
  [GroundLayer.Rock]: {
    base: [0x7a7266, 0x958c7c, 0x857c70],
    freq: 4,
    grain: 0.12,
    detail: seq(pebbles([0x9c9484, 0x8a8274, 0xaaa290, 0x7a7468], 120, 10, 26, 0.45), cracks(0x4a443c, 14, 50, 1.5, 0.4)),
  },
  [GroundLayer.Snow]: {
    base: [0xc9d4e6, 0xe8eef8, 0xdbe4f2],
    freq: 3,
    grain: 0.05,
    detail: seq(blobs([0xa8b8d8, 0xffffff], 40, 20, 60, 0.35), pebbles([0xf4f8ff], 60, 1, 2, 0.08)),
  },
  [GroundLayer.Ice]: {
    base: [0x8ec0dc, 0xbfe2f6, 0xa6d2ea],
    freq: 2,
    grain: 0.05,
    detail: seq(blobs([0xe8f6ff, 0x6aa0c8], 20, 30, 80, 0.3), cracks(0xf0faff, 20, 90, 1.5, 0.7), cracks(0x4a7aa0, 10, 70, 1, 0.4)),
  },
  [GroundLayer.Leaves]: {
    base: [0x5a4426, 0x735a30, 0x66502a],
    freq: 3,
    grain: 0.12,
    detail: seq(leaves([0xb06a28, 0xd09a3a, 0x8a4a20, 0x9a8a3a, 0x6a7a30], 900, 7)),
  },
  [GroundLayer.Vines]: {
    base: [0x2a4a2a, 0x3f6a36, 0x34583a],
    freq: 3,
    grain: 0.12,
    detail: seq(cracks(0x5a7a3a, 40, 120, 3, 0.8), leaves([0x4a8a3a, 0x6aaa4a, 0x2f6a30], 700, 6)),
  },
  [GroundLayer.Tiles]: {
    base: [0x5a5c50, 0x6e6e62, 0x56604a],
    freq: 4,
    grain: 0.14,
    detail: seq(
      slabs(0x2c2e26, [0x7a7a70, 0x6a6c62, 0x84806e, 0x62665a], 5),
      cracks(0x34342c, 18, 40, 1.4, 0.5),
      blobs([0x3f6a32, 0x4a7a3a], 26, 14, 40, 0.55),
    ),
  },
  [GroundLayer.Sand]: {
    base: [0xb89c6c, 0xd0b884, 0xc4aa78],
    freq: 3,
    grain: 0.08,
    detail: seq(ripples(0x8a7448, 60), pebbles([0xe0d0a8], 40, 1, 3, 0.15)),
  },
  [GroundLayer.Blight]: {
    base: [0x3b2638, 0x5a3a52, 0x4a2e48],
    freq: 4,
    grain: 0.14,
    detail: seq(
      blobs([0x24142a, 0x6e4a66], 36, 20, 60, 0.45),
      cracks(0x1c0e1c, 40, 90, 2.4, 0.7),
      cracks(0x7a5a72, 18, 50, 1.2, 0.35),
      pebbles([0xb8ac90, 0x8a7e6a], 18, 2, 4, 0.4),
      blobs([0x5a7a2a], 10, 6, 14, 0.4),
    ),
  },
  [GroundLayer.Cliff]: {
    base: [0x6a5a4a, 0x8a7a64, 0x75665a],
    freq: 3,
    grain: 0.14,
    strata: 0.45,
    detail: seq(cracks(0x2e261e, 46, 90, 2.6, 0.65), cracks(0xa89880, 20, 50, 1.2, 0.35)),
  },
  [GroundLayer.CliffDark]: {
    base: [0x3e3846, 0x5a5466, 0x4a4454],
    freq: 3,
    grain: 0.14,
    strata: 0.45,
    detail: seq(cracks(0x16121c, 46, 90, 2.6, 0.7), cracks(0x7a7488, 20, 50, 1.2, 0.35)),
  },
  [GroundLayer.Dark]: {
    base: [0x241e22, 0x3a3034, 0x2e2628],
    freq: 4,
    grain: 0.14,
    detail: seq(cracks(0x7a2a10, 16, 70, 2, 0.5), pebbles([0x4a4044], 60, 3, 9, 0.4)),
  },
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Paints one layer into `out` (RGBA, size×size). */
const makeLayer = (layer: number, size: number, out: Uint8Array, offset: number): void => {
  const p = PAINTERS[layer]!;
  const c0 = hex(p.base[0]);
  const c1 = hex(p.base[1]);
  const c2 = hex(p.base[2]);
  // Low-res blotches (tileable fbm).
  const low = new Float32Array(LOW * LOW * 3);
  for (let y = 0; y < LOW; y++) {
    for (let x = 0; x < LOW; x++) {
      const u = (x / LOW) * p.freq;
      const v = (y / LOW) * p.freq;
      const n1 = fbm(u, v, 4, layer * 17 + 3, p.freq);
      const n2 = fbm(u + 7.3, v + 2.1, 3, layer * 17 + 9, p.freq);
      const t1 = Math.min(1, Math.max(0, (n1 - 0.3) / 0.4));
      const t2 = Math.min(1, Math.max(0, (n2 - 0.4) / 0.25));
      let strata = 1;
      if (p.strata) {
        const band = fbm(0.5, (y / LOW) * 6, 3, layer * 31, 6);
        strata = 1 - p.strata + p.strata * 2 * band;
      }
      const o = (y * LOW + x) * 3;
      for (let k = 0; k < 3; k++) low[o + k] = lerp(lerp(c0[k]!, c1[k]!, t1), c2[k]!, t2 * 0.6) * strata;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const scale = LOW / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % LOW) * LOW;
    const r1 = ((y0 + 1) % LOW) * LOW;
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = (r0 + (x0 % LOW)) * 3;
      const b = (r0 + ((x0 + 1) % LOW)) * 3;
      const c = (r1 + (x0 % LOW)) * 3;
      const e = (r1 + ((x0 + 1) % LOW)) * 3;
      const g = 1 + (hash2(x, y, layer) - 0.5) * 2 * p.grain;
      const o = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = lerp(low[a + k]!, low[b + k]!, sx);
        const bot = lerp(low[c + k]!, low[e + k]!, sx);
        d[o + k] = Math.min(255, lerp(top, bot, sy) * g);
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (p.detail) {
    ctx.save();
    ctx.scale(size / 512, size / 512);
    p.detail(ctx, 512, makeRand(layer * 7919 + 13));
    ctx.restore();
  }
  out.set(ctx.getImageData(0, 0, size, size).data, offset);
};

export interface GroundTextures {
  layers: DataArrayTexture;
  noise: DataTexture;
  dispose(): void;
}

/** Generates all ground layers. `size` must be a power of two. */
export const createGroundTextures = (size = 512): GroundTextures => {
  const data = new Uint8Array(size * size * 4 * GROUND_LAYER_COUNT);
  for (let l = 0; l < GROUND_LAYER_COUNT; l++) makeLayer(l, size, data, l * size * size * 4);
  const layers = new DataArrayTexture(data, size, size, GROUND_LAYER_COUNT);
  layers.format = RGBAFormat;
  layers.type = UnsignedByteType;
  layers.colorSpace = SRGBColorSpace;
  layers.wrapS = layers.wrapT = RepeatWrapping;
  layers.magFilter = LinearFilter;
  layers.minFilter = LinearMipmapLinearFilter;
  layers.generateMipmaps = true;
  layers.anisotropy = 4;
  layers.needsUpdate = true;

  return { layers, noise: createNoiseTexture(), dispose: () => layers.dispose() };
};

let noiseTex: DataTexture | null = null;

/** Tileable RGBA noise: R = broad fbm, G = medium fbm, B = fine fbm, A = cell hash. Shared. */
export const createNoiseTexture = (): DataTexture => {
  if (noiseTex) return noiseTex;
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      d[o] = fbm((x / N) * 4, (y / N) * 4, 4, 11, 4) * 255;
      d[o + 1] = fbm((x / N) * 8, (y / N) * 8, 3, 23, 8) * 255;
      d[o + 2] = fbm((x / N) * 32, (y / N) * 32, 2, 37, 32) * 255;
      d[o + 3] = hash2(x >> 3, y >> 3, 41) * 255;
    }
  }
  const t = new DataTexture(d, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
};
