// Deterministic hash + value noise for procedural art (textures, geometry jitter, variation).
// Render-side only, but deterministic so screenshots are stable.

/** Integer hash of (x, y, seed) → [0, 1). */
export const hash2 = (x: number, y: number, seed = 0): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

export const hash1 = (n: number, seed = 0): number => hash2(n, 0x5bd1e995, seed);

/** Hash of a float 3D position (quantised), stable for duplicated vertices. */
export const hash3f = (x: number, y: number, z: number, seed = 0): number =>
  hash2(Math.round(x * 8) + Math.imul(Math.round(z * 8), 7919), Math.round(y * 8), seed);

/** Hash of a string → uint32 (FNV-1a). */
export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const fade = (t: number): number => t * t * (3 - 2 * t);

const wrap = (v: number, period: number): number => (period > 0 ? ((v % period) + period) % period : v);

/** Smooth value noise in [0, 1). With `period` > 0 it tiles every `period` units (integer lattice). */
export const valueNoise = (x: number, y: number, seed = 0, period = 0): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrap(ix, period);
  const y0 = wrap(iy, period);
  const x1 = wrap(ix + 1, period);
  const y1 = wrap(iy + 1, period);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

/** Fractal value noise in [0, 1). `period` tiles the base octave (doubles per octave). */
export const fbm = (x: number, y: number, octaves = 4, seed = 0, period = 0): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 101, period * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
};

/** Small seeded PRNG (mulberry32) for render-side procedural layout. */
export const makeRand = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
