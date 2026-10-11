// Low-poly tree geometries (near + far LOD) for each tree look. Units: WC3 (≈ inches), base at y = 0.
import type { BufferGeometry } from 'three';
import { ModelBuilder, coneB, cylB, horn, ico } from './geom';

export type TreeKind = 'ashen' | 'summer' | 'pine' | 'twisted';

export const TREE_KINDS: readonly TreeKind[] = ['ashen', 'summer', 'pine', 'twisted'];

export interface TreeGeometries {
  near: BufferGeometry;
  far: BufferGeometry;
}

const BARK_ASHEN = 0x4c3c44;
const LEAF_ASHEN = 0x2c6e4c;
const LEAF_ASHEN_TOP = 0x3f8f5a;

const ashen = (): TreeGeometries => {
  const n = new ModelBuilder();
  n.add(horn([8, 310, 4], [-12, 150, 0], 21, 9, 4, 6), undefined, { color: BARK_ASHEN, grad: 0.4, seed: 1 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    n.add(horn([Math.cos(a) * 46, -6, Math.sin(a) * 46], [Math.cos(a) * 20, 6, Math.sin(a) * 20], 11, 2, 2, 4), { p: [0, 20, 0] }, { color: BARK_ASHEN, seed: 2 + i });
  }
  n.add(horn([-74, 70, 30], [-30, 40, 10], 8, 2, 2, 4), { p: [0, 190, 0] }, { color: BARK_ASHEN, seed: 7 });
  n.add(horn([70, 64, -34], [30, 30, -10], 8, 2, 2, 4), { p: [4, 200, 0] }, { color: BARK_ASHEN, seed: 8 });
  const blob = (p: [number, number, number], r: number, col: number, seed: number, sy = 0.78): void => {
    n.add(ico(r, 1), { p, s: [1, sy, 1] }, { color: col, jitter: r * 0.13, grad: 0.55, shade: 0.1, seed });
  };
  blob([0, 300, 0], 116, LEAF_ASHEN, 11);
  blob([-62, 250, 42], 80, LEAF_ASHEN, 12);
  blob([64, 256, -36], 78, LEAF_ASHEN, 13);
  blob([6, 382, 4], 74, LEAF_ASHEN_TOP, 14, 0.85);

  const f = new ModelBuilder();
  f.add(cylB(9, 20, 300, 4, true), undefined, { color: BARK_ASHEN, grad: 0.4 });
  f.add(ico(120, 0), { p: [0, 295, 0], s: [1, 0.8, 1] }, { color: LEAF_ASHEN, grad: 0.55, jitter: 10 });
  f.add(ico(78, 0), { p: [4, 378, 4], s: [1, 0.85, 1] }, { color: LEAF_ASHEN_TOP, grad: 0.5 });
  return { near: n.build(), far: f.build() };
};

const BARK_SUMMER = 0x5c4230;
const LEAF_SUMMER = 0x467f2c;
const LEAF_SUMMER_TOP = 0x5f9a38;

const summer = (): TreeGeometries => {
  const n = new ModelBuilder();
  n.add(horn([4, 240, -6], [10, 120, 6], 19, 9, 3, 6), undefined, { color: BARK_SUMMER, grad: 0.4, seed: 21 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.1;
    n.add(horn([Math.cos(a) * 40, -6, Math.sin(a) * 40], [Math.cos(a) * 16, 6, Math.sin(a) * 16], 10, 2, 2, 4), { p: [0, 16, 0] }, { color: BARK_SUMMER, seed: 22 + i });
  }
  const blob = (p: [number, number, number], r: number, col: number, seed: number): void => {
    n.add(ico(r, 1), { p, s: [1, 0.85, 1] }, { color: col, jitter: r * 0.14, grad: 0.55, seed });
  };
  blob([0, 270, 0], 112, LEAF_SUMMER, 31);
  blob([-58, 220, -30], 76, LEAF_SUMMER, 32);
  blob([50, 330, 30], 76, LEAF_SUMMER_TOP, 33);
  const f = new ModelBuilder();
  f.add(cylB(9, 18, 240, 4, true), undefined, { color: BARK_SUMMER });
  f.add(ico(122, 0), { p: [0, 280, 0], s: [1, 0.9, 1] }, { color: LEAF_SUMMER, grad: 0.55, jitter: 12 });
  return { near: n.build(), far: f.build() };
};

const BARK_PINE = 0x3e3030;
const NEEDLE = 0x234038;
const SNOW = 0xd8e4f0;

const pine = (): TreeGeometries => {
  const n = new ModelBuilder();
  n.add(cylB(9, 17, 120, 6), undefined, { color: BARK_PINE });
  const tiers: Array<[number, number, number]> = [
    [70, 126, 170],
    [160, 100, 150],
    [245, 76, 130],
    [320, 50, 120],
  ];
  tiers.forEach(([y, r, h], i) => {
    n.add(coneB(r, h, 8), { p: [0, y, 0] }, { color: NEEDLE, jitter: 6, grad: 0.6, seed: 40 + i });
    n.add(coneB(r * 0.55, h * 0.42, 8), { p: [0, y + h * 0.58, 0] }, { color: SNOW, jitter: 3, grad: 0.15, seed: 50 + i });
  });
  const f = new ModelBuilder();
  f.add(cylB(9, 15, 90, 3, true), undefined, { color: BARK_PINE });
  f.add(coneB(124, 260, 6), { p: [0, 70, 0] }, { color: NEEDLE, grad: 0.6 });
  f.add(coneB(70, 170, 6), { p: [0, 270, 0] }, { color: NEEDLE, grad: 0.4 });
  return { near: n.build(), far: f.build() };
};

const BARK_DEAD = 0x3a2c3c;
const LEAF_DEAD = 0x4a3654;
const LEAF_SICK = 0x56603a;

const twisted = (): TreeGeometries => {
  const n = new ModelBuilder();
  n.add(horn([24, 170, 12], [-34, 90, 0], 25, 14, 4, 6), undefined, { color: BARK_DEAD, grad: 0.45, seed: 61 });
  n.add(horn([-34, 150, -16], [30, 80, 0], 14, 6, 4, 6), { p: [24, 166, 12] }, { color: BARK_DEAD, grad: 0.3, seed: 62 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.2;
    n.add(horn([Math.cos(a) * 54, -8, Math.sin(a) * 54], [Math.cos(a) * 24, 8, Math.sin(a) * 24], 12, 2, 2, 4), { p: [0, 18, 0] }, { color: BARK_DEAD, seed: 63 + i });
  }
  const spikes: Array<[[number, number, number], [number, number, number], [number, number, number], number]> = [
    [[10, 230, 0], [-110, 90, 30], [-40, 30, 30], 8],
    [[20, 200, 10], [100, 110, -40], [50, 10, -20], 8],
    [[-8, 300, -4], [-70, 90, -60], [-10, 50, -30], 6],
    [[-8, 310, -4], [60, 100, 50], [30, 30, 10], 6],
    [[14, 150, 8], [90, 40, 70], [40, 30, 20], 7],
    [[-10, 120, 0], [-80, 60, -50], [-40, 10, -10], 7],
  ];
  spikes.forEach(([p, tip, ctrl, r], i) => n.add(horn(tip, ctrl, r, 0.6, 3, 4), { p }, { color: BARK_DEAD, seed: 70 + i }));
  n.add(ico(58, 0), { p: [-60, 330, -40], s: [1, 0.7, 1] }, { color: LEAF_DEAD, jitter: 9, grad: 0.5, seed: 81 });
  n.add(ico(48, 0), { p: [70, 300, 40], s: [1, 0.7, 1] }, { color: LEAF_SICK, jitter: 8, grad: 0.5, seed: 82 });
  n.add(ico(44, 0), { p: [-20, 400, -10], s: [1, 0.75, 1] }, { color: LEAF_DEAD, jitter: 8, grad: 0.5, seed: 83 });
  const f = new ModelBuilder();
  f.add(horn([-10, 330, -6], [10, 160, 0], 22, 6, 2, 4), undefined, { color: BARK_DEAD });
  f.add(horn([-110, 90, 30], [-40, 30, 30], 9, 1, 1, 3), { p: [0, 220, 0] }, { color: BARK_DEAD });
  f.add(horn([100, 110, -40], [50, 10, -20], 9, 1, 1, 3), { p: [0, 200, 0] }, { color: BARK_DEAD });
  f.add(ico(60, 0), { p: [-40, 330, -20], s: [1.3, 0.7, 1] }, { color: LEAF_DEAD, grad: 0.5 });
  return { near: n.build(), far: f.build() };
};

const BUILDERS: Record<TreeKind, () => TreeGeometries> = { ashen, summer, pine, twisted };

const cache = new Map<TreeKind, TreeGeometries>();

/** Shared (cached) geometries for a tree kind. */
export const treeGeometries = (kind: TreeKind): TreeGeometries => {
  let g = cache.get(kind);
  if (!g) {
    g = BUILDERS[kind]();
    cache.set(kind, g);
  }
  return g;
};

export const disposeTreeGeometries = (): void => {
  for (const g of cache.values()) {
    g.near.dispose();
    g.far.dispose();
  }
  cache.clear();
};

/** Picks the model for a map tree style. Trees standing on blight die (Scourge art direction). */
export const treeKindFor = (style: string, onBlight: boolean): TreeKind => {
  if (style === 'northrend') return 'pine';
  if (style === 'blight' || onBlight) return 'twisted';
  if (style === 'ashenvale') return 'ashen';
  return 'summer';
};
