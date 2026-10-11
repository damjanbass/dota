// Procedural low-poly WC3-style buildings. Each model = ONE vertex-coloured mesh (shared painted
// material, per-vertex glow) + one additive glow-billboard mesh. Models face +X (WC3 facing 0),
// sit on y = 0 and are sized in WC3 units. Geometry is cached per (kind, team, tier).
import { Group, Mesh } from 'three';
import type { Object3D } from 'three';
import type { MapEntityKind } from '../core/map';
import type { Team, Tier } from '../core/types';
import {
  ModelBuilder,
  box,
  boxB,
  coneB,
  crescent,
  cylB,
  dodeca,
  horn,
  ico,
  lathe,
  octa,
  ring,
  sphere,
  torus,
} from './geom';
import type { V3 } from './geom';
import { createGlowMesh } from './glow';
import type { GlowSpec } from './glow';
import { getPaintedMaterial } from './materials';
import { makeRand } from './noise';

export type BuildingKind = Extract<
  MapEntityKind,
  'tower' | 'barracks_melee' | 'barracks_ranged' | 'ancient' | 'fountain' | 'shop' | 'secret_shop' | 'side_shop' | 'tavern'
>;

export const BUILDING_KINDS: readonly BuildingKind[] = [
  'tower',
  'barracks_melee',
  'barracks_ranged',
  'ancient',
  'fountain',
  'shop',
  'secret_shop',
  'side_shop',
  'tavern',
];

export const isBuildingKind = (k: string): k is BuildingKind => (BUILDING_KINDS as readonly string[]).includes(k);

// --- Palettes -----------------------------------------------------------------
const S = {
  stone: 0x6c70a8,
  stoneDark: 0x484a7c,
  stoneLight: 0x8c90c4,
  wood: 0x6a4a3c,
  woodLight: 0x8c6a50,
  bark: 0x54424e,
  leaf: 0x2f7a5a,
  leafLight: 0x48a070,
  trim: 0xc8d2ee,
  gold: 0xd8b45a,
  moon: 0xa8ecff,
  moonGlow: 0x7fd8ff,
};
const U = {
  stone: 0x3c3444,
  stoneDark: 0x2a2430,
  purple: 0x4e3a5e,
  slate: 0x3a3048,
  bone: 0xd8ccac,
  boneDark: 0xa89878,
  metal: 0x4a4650,
  green: 0x8cff5a,
  greenGlow: 0x6aff3a,
  ice: 0xa8dcff,
  iceGlow: 0x7cd0ff,
};

interface Built {
  b: ModelBuilder;
  glows: GlowSpec[];
}

const start = (): Built => ({ b: new ModelBuilder(), glows: [] });

/** Ring of horns (spikes, ribs, roots) around the Y axis. */
const hornRing = (
  b: ModelBuilder,
  n: number,
  radius: number,
  y: number,
  tip: (a: number) => V3,
  ctrl: (a: number) => V3,
  r0: number,
  color: number,
  phase = 0,
  r1 = 0.6,
  emissive = 0,
): void => {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    b.add(horn(tip(a), ctrl(a), r0, r1, 4, 5), { p: [Math.cos(a) * radius, y, Math.sin(a) * radius] }, { color, emissive, seed: i + 300 });
  }
};

const outward = (len: number, up: number) => (a: number): V3 => [Math.cos(a) * len, up, Math.sin(a) * len];

// --- Towers -------------------------------------------------------------------

const sentinelTower = (tier: Tier): Built => {
  const o = start();
  const { b, glows } = o;
  const t4 = tier === 4;
  const H = t4 ? 1.12 : 1;
  b.add(cylB(116, 128, 26, 8), undefined, { color: S.stoneDark, jitter: 2 });
  b.add(cylB(98, 110, 22, 8), { p: [0, 26, 0] }, { color: S.stone });
  for (const [x, y, z] of ring(8, 108, 30, Math.PI / 8)) {
    b.add(boxB(5, 12, 12), { p: [x, y - 18, z], r: [0, -Math.atan2(z, x), 0] }, { color: S.moon, emissive: 0.9 });
  }
  const y1 = 48;
  const lowH = 120 * H;
  b.add(cylB(56, 72, lowH, 8), { p: [0, y1, 0] }, { color: S.stone, jitter: 2, grad: 0.35 });
  b.add(cylB(66, 66, 10, 8), { p: [0, y1 + lowH, 0] }, { color: t4 ? S.gold : S.trim });
  const y0 = y1 + lowH + 10;
  const shaftH = 130 * H;
  b.add(cylB(30, 42, shaftH, 7), { p: [0, y0, 0] }, { color: S.wood, grad: 0.3 });
  // Curved wooden ribs sweeping from the plinth up to the bowl.
  const ribs = t4 ? 6 : 4;
  hornRing(b, ribs, 84, 40, (a) => [-Math.cos(a) * 40, lowH + shaftH * 0.9, -Math.sin(a) * 40], (a) => [Math.cos(a) * 46, lowH * 0.9, Math.sin(a) * 46], 11, S.woodLight, Math.PI / 4, 5);
  const yTop = y0 + shaftH;
  b.add(cylB(76, 44, 28, 8), { p: [0, yTop, 0] }, { color: S.stone, grad: 0.2 });
  b.add(cylB(80, 80, 8, 8), { p: [0, yTop + 28, 0] }, { color: t4 ? S.gold : S.trim });
  // Crescent horns cradling the moon orb.
  hornRing(b, 3, 62, yTop + 32, (a) => [-Math.cos(a) * 34, 120, -Math.sin(a) * 34], (a) => [Math.cos(a) * 34, 70, Math.sin(a) * 34], 9, S.trim, 0.5);
  if (t4) {
    hornRing(b, 3, 70, yTop + 32, (a) => [Math.cos(a) * 50, 90, Math.sin(a) * 50], (a) => [Math.cos(a) * 10, 50, Math.sin(a) * 10], 7, S.gold, 0.5 + Math.PI / 3);
    for (const [x, , z] of ring(4, 100, 0, Math.PI / 4)) {
      b.add(crescent(40, 14, 6), { p: [x, 92, z], r: [0, -Math.atan2(z, x) + Math.PI / 2, Math.PI / 2] }, { color: S.trim });
    }
  }
  const orbY = yTop + 96;
  const orbR = t4 ? 36 : 28;
  b.add(ico(orbR, 1), { p: [0, orbY, 0] }, { color: S.moon, emissive: 1.3, flat: false });
  glows.push({ p: [0, orbY, 0], size: t4 ? 360 : 250, color: S.moonGlow, intensity: 0.85 });
  glows.push({ p: [0, orbY, 0], size: orbR * 3, color: 0xffffff, intensity: 0.6 });
  // Leaf tufts where the ribs meet the bowl.
  for (const [x, , z] of ring(ribs, 56, 0, Math.PI / 4)) {
    b.add(ico(26, 0), { p: [x, yTop + 6, z], s: [1, 0.7, 1] }, { color: S.leafLight, jitter: 4 });
  }
  return o;
};

const scourgeTower = (tier: Tier): Built => {
  const o = start();
  const { b, glows } = o;
  const t4 = tier === 4;
  const H = t4 ? 1.12 : 1;
  b.add(boxB(232, 36, 232), undefined, { color: U.stoneDark, jitter: 3 });
  b.add(boxB(190, 34, 190), { p: [0, 36, 0] }, { color: U.purple, jitter: 2 });
  b.add(boxB(150, 30, 150), { p: [0, 70, 0] }, { color: U.stoneDark });
  // Glowing rune slits on the middle step.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(box(4, 10, 50), { p: [Math.cos(a) * 96, 52, Math.sin(a) * 96], r: [0, -a, 0] }, { color: U.green, emissive: 1.1 });
  }
  // Corner bone spikes on each step.
  const corners = (half: number, y: number, len: number, r0: number): void => {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      b.add(horn([sx * len * 0.55, len, sz * len * 0.55], [sx * len * 0.5, len * 0.2, sz * len * 0.5], r0, 0.5, 4, 5), { p: [sx * half, y, sz * half] }, { color: U.bone, seed: sx * 3 + sz });
    }
  };
  corners(108, 30, 70, 11);
  corners(88, 64, 56, 9);
  const pillarH = 190 * H;
  b.add(cylB(42, 64, pillarH, 4), { p: [0, 100, 0], r: [0, Math.PI / 4, 0] }, { color: U.purple, grad: 0.35, jitter: 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(box(3, 60 * H, 10), { p: [Math.cos(a) * 44, 100 + pillarH * 0.45, Math.sin(a) * 44], r: [0, -a, 0] }, { color: U.green, emissive: 1.0 });
  }
  // Ribcage around the upper pillar.
  hornRing(b, t4 ? 8 : 6, 48, 120 + pillarH * 0.25, (a) => [Math.cos(a) * 10, pillarH * 0.7, Math.sin(a) * 10], (a) => [Math.cos(a) * 60, pillarH * 0.35, Math.sin(a) * 60], 7, U.bone, 0, 2);
  const yTop = 100 + pillarH;
  b.add(cylB(60, 40, 22, 6), { p: [0, yTop, 0] }, { color: U.metal });
  // Claws cradling the orb.
  hornRing(b, 4, 50, yTop + 18, (a) => [-Math.cos(a) * 40, 110, -Math.sin(a) * 40], (a) => [Math.cos(a) * 40, 60, Math.sin(a) * 40], 9, U.bone, Math.PI / 4);
  if (t4) {
    hornRing(b, 4, 64, yTop + 10, (a) => [Math.cos(a) * 70, 80, Math.sin(a) * 70], (a) => [Math.cos(a) * 20, 40, Math.sin(a) * 20], 8, U.boneDark, 0);
    // Skulls on the front of the plinth.
    for (const z of [-50, 50]) {
      b.add(sphere(16, 6, 5), { p: [118, 54, z], s: [0.9, 1, 1] }, { color: U.bone });
      b.add(box(10, 6, 6), { p: [130, 50, z - 6] }, { color: U.green, emissive: 1.2 });
      b.add(box(10, 6, 6), { p: [130, 50, z + 6] }, { color: U.green, emissive: 1.2 });
    }
  }
  const orbY = yTop + 82;
  const orbR = t4 ? 34 : 27;
  b.add(ico(orbR, 1), { p: [0, orbY, 0] }, { color: U.green, emissive: 1.3, flat: false });
  glows.push({ p: [0, orbY, 0], size: t4 ? 340 : 240, color: U.greenGlow, intensity: 0.85 });
  glows.push({ p: [0, orbY, 0], size: orbR * 3, color: 0xe0ffd0, intensity: 0.5 });
  return o;
};

// --- Barracks -----------------------------------------------------------------

const sentinelMelee = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(cylB(160, 172, 22, 8), undefined, { color: S.stoneDark, jitter: 3 });
  b.add(lathe([[0, 0], [150, 0], [142, 30], [112, 80], [96, 150], [106, 200], [120, 228], [0, 236]], 9), { p: [0, 20, 0] }, { color: S.bark, jitter: 6, grad: 0.4 });
  hornRing(b, 6, 110, 40, outward(90, -60), outward(40, 20), 22, S.bark, 0.3, 5);
  b.add(ico(120, 1), { p: [0, 290, 0], s: [1.15, 0.7, 1.15] }, { color: S.leaf, jitter: 14, grad: 0.5 });
  b.add(ico(80, 1), { p: [-40, 340, 40], s: [1, 0.75, 1] }, { color: S.leafLight, jitter: 10, grad: 0.5 });
  b.add(ico(70, 1), { p: [50, 330, -50], s: [1, 0.75, 1] }, { color: S.leafLight, jitter: 9, grad: 0.5 });
  // Doorway with inner glow.
  b.add(boxB(30, 90, 70), { p: [128, 20, 0] }, { color: 0x1a1830 });
  b.add(boxB(8, 70, 50), { p: [140, 26, 0] }, { color: S.moon, emissive: 0.8 });
  b.add(crescent(52, 12, 10, Math.PI), { p: [140, 100, 0], r: [0, Math.PI / 2, Math.PI / 2] }, { color: S.trim });
  // Tusks / war horns.
  for (const z of [-80, 80]) {
    b.add(horn([110, 70, z * 0.2], [60, -10, 0], 16, 1, 5, 6), { p: [100, 70, z] }, { color: S.woodLight });
  }
  glows.push({ p: [150, 60, 0], size: 180, color: S.moonGlow, intensity: 0.5 });
  return o;
};

const sentinelRanged = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(cylB(158, 170, 24, 8), undefined, { color: S.stoneDark, jitter: 3 });
  b.add(cylB(118, 126, 110, 10), { p: [0, 24, 0] }, { color: S.stone, grad: 0.35 });
  b.add(cylB(128, 128, 10, 10), { p: [0, 134, 0] }, { color: S.trim });
  hornRing(b, 6, 118, 140, (a) => [-Math.cos(a) * 112, 150, -Math.sin(a) * 112], (a) => [Math.cos(a) * 10, 150, Math.sin(a) * 10], 10, S.woodLight, 0, 4);
  b.add(lathe([[120, 0], [110, 40], [84, 90], [44, 126], [0, 136]], 10), { p: [0, 140, 0] }, { color: S.leaf, jitter: 6, grad: 0.4 });
  b.add(octa(26), { p: [0, 312, 0], s: [1, 1.8, 1] }, { color: S.moon, emissive: 1.2 });
  glows.push({ p: [0, 312, 0], size: 220, color: S.moonGlow, intensity: 0.8 });
  b.add(boxB(20, 80, 60), { p: [118, 24, 0] }, { color: 0x1a1830 });
  b.add(boxB(6, 64, 44), { p: [126, 30, 0] }, { color: S.moon, emissive: 0.7 });
  b.add(crescent(60, 16, 10), { p: [132, 150, 0], r: [0, Math.PI / 2, Math.PI / 2] }, { color: S.trim });
  for (const z of [-90, 90]) {
    b.add(cylB(14, 18, 150, 6), { p: [140, 0, z] }, { color: S.stoneLight });
    b.add(ico(14, 0), { p: [140, 160, z] }, { color: S.moon, emissive: 1 });
    glows.push({ p: [140, 160, z], size: 90, color: S.moonGlow, intensity: 0.6 });
  }
  return o;
};

const scourgeMelee = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(300, 28, 300), undefined, { color: U.stoneDark, jitter: 3 });
  b.add(boxB(250, 30, 250), { p: [0, 28, 0] }, { color: U.stone, jitter: 2 });
  b.add(boxB(200, 90, 200), { p: [0, 58, 0] }, { color: U.purple, grad: 0.35 });
  b.add(cylB(0, 170, 140, 4), { p: [0, 148, 0], r: [0, Math.PI / 4, 0] }, { color: U.slate, jitter: 3, grad: 0.4 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    b.add(horn([sx * 50, 110, sz * 50], [sx * 40, 20, sz * 40], 13, 0.5, 4, 5), { p: [sx * 100, 148, sz * 100] }, { color: U.bone });
    b.add(cylB(16, 22, 170, 6), { p: [sx * 126, 28, sz * 126] }, { color: U.stoneDark });
    b.add(horn([0, 60, 0], [sx * 10, 30, sz * 10], 12, 0.5, 3, 5), { p: [sx * 126, 198, sz * 126] }, { color: U.bone });
  }
  // Doorway + ribs.
  b.add(boxB(20, 80, 80), { p: [100, 58, 0] }, { color: 0x10100c });
  b.add(boxB(6, 64, 60), { p: [110, 64, 0] }, { color: U.green, emissive: 0.9 });
  for (let i = 0; i < 4; i++) {
    const z = -45 + i * 30;
    b.add(horn([30, 70, 0], [40, 10, 0], 6, 1, 4, 4), { p: [104, 100, z] }, { color: U.bone });
  }
  for (const z of [-70, 70]) b.add(horn([110, 40, z * 0.3], [50, -20, 0], 14, 1, 5, 6), { p: [110, 60, z] }, { color: U.bone });
  glows.push({ p: [120, 96, 0], size: 200, color: U.greenGlow, intensity: 0.6 });
  return o;
};

const scourgeRanged = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(290, 28, 290), undefined, { color: U.stoneDark, jitter: 3 });
  b.add(boxB(150, 170, 150), { p: [0, 28, 0] }, { color: U.purple, grad: 0.35 });
  b.add(cylB(0, 122, 120, 4), { p: [0, 198, 0], r: [0, Math.PI / 4, 0] }, { color: U.slate, grad: 0.4 });
  b.add(ico(22, 1), { p: [0, 336, 0] }, { color: U.green, emissive: 1.2, flat: false });
  glows.push({ p: [0, 336, 0], size: 200, color: U.greenGlow, intensity: 0.75 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(box(4, 50, 30), { p: [Math.cos(a) * 76, 150, Math.sin(a) * 76], r: [0, -a, 0] }, { color: U.green, emissive: 1 });
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    b.add(cylB(18, 26, 210, 6), { p: [sx * 118, 28, sz * 118] }, { color: U.stone, grad: 0.3 });
    b.add(horn([sx * 30, 80, sz * 30], [sx * 30, 20, sz * 30], 12, 0.5, 4, 5), { p: [sx * 118, 236, sz * 118] }, { color: U.bone });
    b.add(ico(10, 0), { p: [sx * 118, 244, sz * 118] }, { color: U.green, emissive: 1.2 });
    glows.push({ p: [sx * 118, 244, sz * 118], size: 70, color: U.greenGlow, intensity: 0.6 });
  }
  b.add(sphere(22, 7, 5), { p: [80, 176, 0] }, { color: U.bone });
  b.add(box(8, 8, 8), { p: [100, 178, -8] }, { color: U.green, emissive: 1.3 });
  b.add(box(8, 8, 8), { p: [100, 178, 8] }, { color: U.green, emissive: 1.3 });
  b.add(boxB(16, 74, 60), { p: [78, 28, 0] }, { color: 0x10100c });
  return o;
};

// --- Ancients -------------------------------------------------------------------

const worldTree = (): Built => {
  const o = start();
  const { b, glows } = o;
  const rand = makeRand(1100);
  b.add(cylB(430, 462, 40, 12), undefined, { color: S.stoneDark, jitter: 6 });
  b.add(cylB(330, 350, 30, 12), { p: [0, 40, 0] }, { color: S.stone, jitter: 4 });
  for (const [x, y, z] of ring(10, 400, 40, 0.2)) {
    b.add(boxB(30, 70, 20), { p: [x, y, z], r: [0, -Math.atan2(z, x), 0.06] }, { color: S.stoneLight, jitter: 3 });
    b.add(box(4, 30, 10), { p: [x * 1.04, y + 36, z * 1.04], r: [0, -Math.atan2(z, x), 0] }, { color: S.moon, emissive: 1 });
  }
  b.add(lathe([[215, 0], [186, 60], [148, 200], [126, 420], [136, 560], [168, 640], [0, 660]], 10), { p: [0, 60, 0] }, { color: S.bark, jitter: 9, grad: 0.45 });
  hornRing(b, 8, 140, 120, (a) => [Math.cos(a) * 270, -110, Math.sin(a) * 270], (a) => [Math.cos(a) * 140, 30, Math.sin(a) * 140], 48, S.bark, 0.2, 10);
  hornRing(b, 5, 120, 600, (a) => [Math.cos(a) * 340, 270, Math.sin(a) * 340], (a) => [Math.cos(a) * 130, 230, Math.sin(a) * 130], 42, S.bark, 0.6, 12);
  const blob = (p: V3, r: number, col: number, seed: number): void => {
    b.add(ico(r, 1), { p, s: [1, 0.78, 1] }, { color: col, jitter: r * 0.12, grad: 0.55, seed });
  };
  blob([0, 920, 0], 270, S.leaf, 1);
  ring(6, 320, 840, 0.6).forEach((p, i) => blob(p, 190 + (i % 2) * 20, S.leaf, 2 + i));
  ring(3, 150, 1030, 0.1).forEach((p, i) => blob(p, 150, S.leafLight, 10 + i));
  // Glowing blossoms + wisps.
  for (let i = 0; i < 28; i++) {
    const a = rand() * Math.PI * 2;
    const y = 760 + rand() * 360;
    const r = 260 + rand() * 200 - (y - 760) * 0.45;
    const p: V3 = [Math.cos(a) * r, y, Math.sin(a) * r];
    b.add(ico(14 + rand() * 8, 0), { p }, { color: i % 3 === 0 ? 0xffffff : S.moon, emissive: 1.2 });
    if (i % 3 === 0) glows.push({ p, size: 140, color: S.moonGlow, intensity: 0.7 });
  }
  // Glowing doorway in the trunk.
  b.add(boxB(30, 140, 90), { p: [190, 60, 0] }, { color: S.moon, emissive: 0.9 });
  glows.push({ p: [220, 130, 0], size: 320, color: S.moonGlow, intensity: 0.6 });
  glows.push({ p: [0, 500, 0], size: 900, color: 0x3a8aff, intensity: 0.25 });
  return o;
};

const frozenThrone = (): Built => {
  const o = start();
  const { b, glows } = o;
  const rand = makeRand(2200);
  b.add(cylB(420, 452, 72, 8), undefined, { color: U.stoneDark, jitter: 6 });
  b.add(cylB(330, 360, 70, 8), { p: [0, 72, 0] }, { color: U.purple, jitter: 4 });
  b.add(cylB(250, 272, 62, 8), { p: [0, 142, 0] }, { color: U.stone, jitter: 3 });
  for (const [x, y, z] of ring(8, 352, 100, Math.PI / 8)) {
    b.add(box(8, 30, 60), { p: [x, y, z], r: [0, -Math.atan2(z, x), 0] }, { color: U.green, emissive: 1.1 });
  }
  hornRing(b, 12, 420, 50, outward(140, 190), outward(110, 30), 22, U.bone, 0.13);
  hornRing(b, 8, 260, 190, outward(70, 170), outward(60, 30), 16, U.boneDark, 0.4);
  // Main ice spire + satellite crystals.
  const crystal = (h: number, r: number): ReturnType<typeof lathe> =>
    lathe([[0, 0], [r, 0], [r * 0.86, h * 0.28], [r * 0.62, h * 0.6], [r * 0.3, h * 0.86], [0, h]], 6);
  b.add(crystal(920, 130), { p: [0, 200, 0] }, { color: U.ice, emissive: 0.45, grad: 0.1, jitter: 5 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const h = 300 + rand() * 260;
    b.add(crystal(h, 50 + rand() * 30), { p: [Math.cos(a) * 150, 196, Math.sin(a) * 150], r: [Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32] }, { color: 0x9ccff0, emissive: 0.35, jitter: 4, seed: i });
  }
  // Dark crown of spikes around the spire.
  hornRing(b, 8, 70, 820, outward(110, 160), outward(30, 60), 14, U.metal, 0.2);
  b.add(torus(78, 14, 4, 10), { p: [0, 822, 0] }, { color: U.metal });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p: V3 = [Math.cos(a) * 270, 520 + rand() * 300, Math.sin(a) * 270];
    b.add(octa(30), { p, s: [0.7, 1.8, 0.7], r: [0, a, 0.3] }, { color: U.ice, emissive: 0.9 });
    glows.push({ p, size: 120, color: U.iceGlow, intensity: 0.5 });
  }
  glows.push({ p: [0, 1110, 0], size: 420, color: U.iceGlow, intensity: 0.85 });
  glows.push({ p: [0, 700, 0], size: 700, color: 0x5ab0ff, intensity: 0.25 });
  glows.push({ p: [300, 120, 0], size: 260, color: U.greenGlow, intensity: 0.45 });
  return o;
};

// --- Fountains ------------------------------------------------------------------

const moonwell = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(cylB(250, 262, 16, 12), undefined, { color: S.stoneDark, jitter: 3 });
  b.add(lathe([[226, 0], [236, 14], [228, 64], [200, 74], [186, 64], [182, 10]], 14), { p: [0, 16, 0] }, { color: S.stone, grad: 0.3 });
  b.add(cylB(186, 186, 52, 16), { p: [0, 16, 0] }, { color: 0x5ad8ff, emissive: 0.85, flat: false, grad: 0 });
  b.add(cylB(26, 44, 120, 8), { p: [0, 60, 0] }, { color: S.stoneLight });
  b.add(crescent(54, 14, 8), { p: [0, 220, 0], r: [0, 0, Math.PI / 2] }, { color: S.trim });
  b.add(ico(26, 1), { p: [0, 214, 0] }, { color: S.moon, emissive: 1.3, flat: false });
  hornRing(b, 6, 214, 80, (a) => [-Math.cos(a) * 50, 140, -Math.sin(a) * 50], (a) => [Math.cos(a) * 40, 90, Math.sin(a) * 40], 11, S.trim, 0.3);
  for (const p of ring(6, 168, 230, 0.3)) b.add(ico(9, 0), { p }, { color: S.moon, emissive: 1.2 });
  glows.push({ p: [0, 80, 0], size: 520, color: S.moonGlow, intensity: 0.55 });
  glows.push({ p: [0, 214, 0], size: 220, color: 0xd8f6ff, intensity: 0.7 });
  return o;
};

const darkPool = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(cylB(240, 258, 18, 8), undefined, { color: U.stoneDark, jitter: 3 });
  b.add(lathe([[214, 0], [226, 12], [218, 70], [190, 78], [178, 66], [176, 10]], 8), { p: [0, 18, 0] }, { color: U.purple, grad: 0.3 });
  b.add(cylB(180, 180, 56, 8), { p: [0, 18, 0] }, { color: 0x58e83a, emissive: 0.8, grad: 0 });
  hornRing(b, 8, 206, 90, (a) => [-Math.cos(a) * 60, 130, -Math.sin(a) * 60], (a) => [Math.cos(a) * 40, 80, Math.sin(a) * 40], 13, U.bone, 0.39);
  b.add(cylB(10, 46, 220, 4), { p: [0, 50, 0], r: [0, Math.PI / 4, 0] }, { color: U.stone });
  b.add(sphere(22, 7, 5), { p: [0, 280, 0] }, { color: U.bone });
  b.add(box(8, 8, 8), { p: [18, 284, -8] }, { color: U.green, emissive: 1.4 });
  b.add(box(8, 8, 8), { p: [18, 284, 8] }, { color: U.green, emissive: 1.4 });
  glows.push({ p: [0, 90, 0], size: 520, color: U.greenGlow, intensity: 0.5 });
  glows.push({ p: [0, 280, 0], size: 160, color: U.greenGlow, intensity: 0.6 });
  return o;
};

// --- Shops & tavern ---------------------------------------------------------------

const crates = (b: ModelBuilder, x: number, z: number): void => {
  b.add(boxB(34, 34, 34), { p: [x, 0, z], r: [0, 0.3, 0] }, { color: 0x8a6a40 });
  b.add(boxB(28, 28, 28), { p: [x + 4, 34, z - 4], r: [0, -0.2, 0] }, { color: 0x9a7a48 });
  b.add(cylB(16, 18, 40, 8), { p: [x - 10, 0, z + 40] }, { color: 0x6a4a30 });
};

const shop = (team: Team): Built => {
  const o = start();
  const { b, glows } = o;
  const scourge = team === 'scourge';
  b.add(cylB(140, 150, 14, 10), undefined, { color: scourge ? U.stoneDark : S.stoneDark });
  b.add(cylB(106, 116, 112, 10), { p: [0, 14, 0] }, { color: scourge ? U.metal : S.wood, grad: 0.35 });
  b.add(coneB(172, 150, 10), { p: [0, 120, 0] }, { color: scourge ? U.purple : S.leaf, jitter: 8, grad: 0.4 });
  if (scourge) {
    hornRing(b, 5, 120, 150, outward(50, 110), outward(10, 50), 9, U.bone, 0.2);
  } else {
    b.add(ico(40, 0), { p: [0, 270, 0], s: [1, 0.8, 1] }, { color: S.leafLight, jitter: 5 });
  }
  b.add(boxB(16, 76, 52), { p: [108, 14, 0] }, { color: 0x1e1612 });
  b.add(boxB(60, 10, 120), { p: [140, 60, 0] }, { color: scourge ? U.boneDark : S.woodLight });
  crates(b, 160, -90);
  const lamp = scourge ? U.green : 0xffc060;
  for (const z of [-60, 60]) {
    b.add(cylB(4, 5, 110, 5), { p: [150, 0, z] }, { color: 0x3a2a20 });
    b.add(ico(10, 0), { p: [150, 116, z] }, { color: lamp, emissive: 1.3 });
    glows.push({ p: [150, 116, z], size: 100, color: lamp, intensity: 0.7 });
  }
  return o;
};

const secretShop = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(220, 20, 200), undefined, { color: 0x4a4a52, jitter: 4 });
  b.add(boxB(190, 120, 170), { p: [0, 20, 0] }, { color: 0x6a6a5e, jitter: 3, grad: 0.4 });
  b.add(cylB(0, 160, 110, 4), { p: [0, 140, 0], r: [0, Math.PI / 4, 0] }, { color: 0x3a3048, grad: 0.4 });
  b.add(octa(40), { p: [0, 330, 0], s: [0.8, 1.8, 0.8] }, { color: 0xc070ff, emissive: 1.2 });
  glows.push({ p: [0, 330, 0], size: 300, color: 0xb060ff, intensity: 0.8 });
  b.add(boxB(16, 80, 56), { p: [96, 20, 0] }, { color: 0x140e1c });
  b.add(boxB(4, 64, 44), { p: [104, 26, 0] }, { color: 0xb070ff, emissive: 0.8 });
  for (const [x, , z] of ring(5, 190, 0, 0.4)) {
    b.add(boxB(26, 60, 18), { p: [x, 0, z], r: [0, -Math.atan2(z, x), 0.08] }, { color: 0x7a7a84, jitter: 3 });
    b.add(box(4, 22, 8), { p: [x * 1.06, 34, z * 1.06], r: [0, -Math.atan2(z, x), 0] }, { color: 0xc080ff, emissive: 1 });
  }
  for (let i = 0; i < 6; i++) b.add(ico(30 + (i % 3) * 8, 0), { p: [-90 + (i % 3) * 14, 150 + i * 8, -80 + i * 30], s: [1, 0.6, 1] }, { color: 0x3f6a3a, jitter: 5 });
  return o;
};

const sideShop = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(230, 16, 190), undefined, { color: 0x6a5038 });
  for (const [x, z] of [[-100, -80], [-100, 80], [100, -80], [100, 80]] as const) b.add(cylB(7, 8, 160, 6), { p: [x, 16, z] }, { color: 0x5a3e2a });
  for (let i = 0; i < 6; i++) {
    const z = -90 + i * 30 + 15;
    b.add(box(240, 6, 30), { p: [10, 186, z], r: [0, 0, -0.18] }, { color: i % 2 ? 0xd8c04a : 0xc0402a, shade: 0.05 });
  }
  b.add(boxB(40, 60, 160), { p: [80, 16, 0] }, { color: 0x8a6a44 });
  b.add(boxB(44, 8, 166), { p: [80, 76, 0] }, { color: 0x6a4a30 });
  crates(b, -60, -40);
  crates(b, -40, 60);
  b.add(torus(26, 6, 4, 10), { p: [120, 220, 0], r: [Math.PI / 2, 0, 0] }, { color: 0x9a8a6a });
  b.add(cylB(4, 4, 60, 5), { p: [120, 160, 0] }, { color: 0x5a3e2a });
  b.add(ico(9, 0), { p: [110, 140, -84] }, { color: 0xffc060, emissive: 1.3 });
  glows.push({ p: [110, 140, -84], size: 90, color: 0xffb040, intensity: 0.7 });
  return o;
};

const tavern = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(330, 30, 270), undefined, { color: 0x6a6660, jitter: 4 });
  b.add(boxB(280, 140, 220), { p: [0, 30, 0] }, { color: 0xc4ae84, grad: 0.3 });
  for (const x of [-140, -46, 46, 140]) b.add(boxB(12, 140, 226), { p: [x, 30, 0] }, { color: 0x5a3e2a });
  b.add(boxB(290, 12, 230), { p: [0, 100, 0] }, { color: 0x5a3e2a });
  // Gable roof: a 3-sided prism lying along Z.
  b.add(cylB(180, 180, 270, 3), { p: [0, 170, -135], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.62] }, { color: 0x8a6434, jitter: 6, grad: 0.3 });
  b.add(boxB(40, 120, 40), { p: [-80, 180, -60] }, { color: 0x6a6660, jitter: 2 });
  b.add(boxB(16, 90, 60), { p: [140, 30, 0] }, { color: 0x2a1c12 });
  for (const z of [-70, 70]) {
    b.add(box(6, 34, 34), { p: [143, 90, z] }, { color: 0xffc070, emissive: 1.1 });
    glows.push({ p: [150, 90, z], size: 110, color: 0xffb050, intensity: 0.55 });
  }
  b.add(boxB(6, 40, 70), { p: [170, 130, 0] }, { color: 0x7a5434 });
  b.add(cylB(4, 4, 60, 4), { p: [160, 120, 0], r: [0, 0, Math.PI / 2] }, { color: 0x3a2a20 });
  return o;
};

// --- Roshan pit -----------------------------------------------------------------

const roshanPit = (): Built => {
  const o = start();
  const { b, glows } = o;
  const rand = makeRand(4242);
  b.add(cylB(330, 360, 10, 12), undefined, { color: 0x3a3430, jitter: 6 });
  // Back dome of boulders, open toward +X.
  for (let ring2 = 0; ring2 < 3; ring2++) {
    const n = 12 - ring2 * 3;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.32 + (i / (n - 1)) * Math.PI * 1.36;
      const R = 330 - ring2 * 80;
      const r = 110 - ring2 * 18 + rand() * 30;
      b.add(dodeca(r), { p: [Math.cos(a) * R, 60 + ring2 * 140, Math.sin(a) * R], r: [rand() * 3, rand() * 3, rand() * 3], s: [1, 0.85, 1] }, { color: ring2 === 2 ? 0x6e665c : 0x5e564e, jitter: r * 0.15, seed: ring2 * 20 + i, grad: 0.4 });
    }
  }
  // Arch pillars + lintel framing the cave mouth.
  for (const z of [-200, 200]) {
    for (let k = 0; k < 3; k++) {
      const r = 80 - k * 10;
      b.add(dodeca(r), { p: [250 + rand() * 20, 60 + k * 120, z * (1 - k * 0.12)], r: [rand() * 3, rand() * 3, 0] }, { color: 0x6a6258, jitter: r * 0.14, seed: 80 + k + (z > 0 ? 5 : 0) });
    }
  }
  for (let k = 0; k < 4; k++) {
    const z = -120 + k * 80;
    b.add(dodeca(80), { p: [250, 380 + Math.sin((k / 3) * Math.PI) * 30, z], r: [rand() * 3, rand() * 3, rand() * 3], s: [1, 0.8, 1] }, { color: 0x726a5e, jitter: 12, seed: 90 + k });
  }
  // Bones scattered at the entrance.
  for (let i = 0; i < 6; i++) {
    b.add(horn([30 + rand() * 30, 6, (rand() - 0.5) * 30], [15, 12, 0], 5, 3, 2, 4), { p: [140 + rand() * 120, 4, -120 + rand() * 240], r: [0, rand() * 6, 0] }, { color: U.bone });
  }
  b.add(sphere(20, 7, 5), { p: [200, 18, -60] }, { color: U.bone });
  b.add(horn([0, 90, 30], [20, 40, 0], 14, 1, 4, 5), { p: [-60, 10, 120] }, { color: U.boneDark });
  glows.push({ p: [-120, 120, 0], size: 300, color: 0xff6a30, intensity: 0.25 });
  return o;
};

// --- Decor ('other' entities on the real map) ---------------------------------------

const ziggurat = (): Built => {
  const o = start();
  const { b, glows } = o;
  b.add(boxB(180, 34, 180), undefined, { color: U.stoneDark, jitter: 3 });
  b.add(boxB(140, 34, 140), { p: [0, 34, 0] }, { color: U.purple, jitter: 2 });
  b.add(boxB(100, 30, 100), { p: [0, 68, 0] }, { color: U.stoneDark });
  b.add(cylB(0, 60, 90, 4), { p: [0, 98, 0], r: [0, Math.PI / 4, 0] }, { color: U.slate, grad: 0.4 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    b.add(horn([sx * 40, 60, sz * 40], [sx * 36, 10, sz * 36], 9, 0.5, 4, 5), { p: [sx * 84, 30, sz * 84] }, { color: U.bone });
  }
  b.add(octa(16), { p: [0, 206, 0], s: [0.8, 1.6, 0.8] }, { color: 0x6ab8ff, emissive: 1.2 });
  glows.push({ p: [0, 206, 0], size: 170, color: 0x5aa8ff, intensity: 0.7 });
  return o;
};

const circleOfPower = (team: Team): Built => {
  const o = start();
  const { b, glows } = o;
  const glow = team === 'scourge' ? U.green : S.moon;
  b.add(cylB(96, 100, 4, 16), undefined, { color: 0x5a5a64 });
  b.add(torus(80, 5, 3, 16), { p: [0, 5, 0] }, { color: glow, emissive: 0.9 });
  for (const [x, y, z] of ring(6, 90, 0, 0.2)) {
    b.add(boxB(14, 26, 10), { p: [x, y, z], r: [0, -Math.atan2(z, x), 0.06] }, { color: 0x7a7a84, jitter: 2 });
    b.add(box(3, 10, 6), { p: [x * 1.08, 14, z * 1.08], r: [0, -Math.atan2(z, x), 0] }, { color: glow, emissive: 1.1 });
  }
  glows.push({ p: [0, 10, 0], size: 180, color: team === 'scourge' ? U.greenGlow : S.moonGlow, intensity: 0.35 });
  return o;
};

// --- Public API ---------------------------------------------------------------------

const templates = new Map<string, Group>();

type TemplateKind = BuildingKind | 'roshan_pit' | 'ziggurat' | 'circle_of_power';

const buildTemplate = (kind: TemplateKind, team: Team, tier: Tier): Built => {
  const scourge = team === 'scourge';
  switch (kind) {
    case 'ziggurat':
      return ziggurat();
    case 'circle_of_power':
      return circleOfPower(team);
    case 'tower':
      return scourge ? scourgeTower(tier) : sentinelTower(tier);
    case 'barracks_melee':
      return scourge ? scourgeMelee() : sentinelMelee();
    case 'barracks_ranged':
      return scourge ? scourgeRanged() : sentinelRanged();
    case 'ancient':
      return scourge ? frozenThrone() : worldTree();
    case 'fountain':
      return scourge ? darkPool() : moonwell();
    case 'shop':
      return shop(team);
    case 'secret_shop':
      return secretShop();
    case 'side_shop':
      return sideShop();
    case 'tavern':
      return tavern();
    case 'roshan_pit':
      return roshanPit();
  }
};

const getTemplate = (kind: TemplateKind, team: Team, tier: Tier): Group => {
  const key = `${kind}:${team}:${tier}`;
  let g = templates.get(key);
  if (g) return g;
  const { b, glows } = buildTemplate(kind, team, tier);
  g = new Group();
  g.name = kind;
  const geo = b.build();
  const mesh = new Mesh(geo, getPaintedMaterial());
  mesh.name = `${kind}_body`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  const glow = createGlowMesh(glows);
  if (glow) g.add(glow);
  const bb = geo.boundingBox!;
  g.userData = {
    kind,
    team,
    tier,
    height: bb.max.y,
    radius: Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z),
    triangles: geo.getAttribute('position').count / 3,
    glows,
  };
  templates.set(key, g);
  return g;
};

export interface BuildingModelOptions {
  /**
   * Include the additive glow-billboard child (default true). The world turns this off and draws
   * every building's glows (userData.glows, model space) in one shared mesh instead.
   */
  glow?: boolean;
}

const instance = (tpl: Group, opts: BuildingModelOptions): Object3D => {
  const o = tpl.clone();
  if (opts.glow === false) o.children.filter((c) => c.name === 'glow').forEach((c) => o.remove(c));
  return o;
};

/**
 * Builds a WC3-style building model facing +X (rotate with `rotation.y = facing`), base at y = 0,
 * sized in WC3 units. Geometry is shared between calls; dispose with `disposeBuildingCache()`.
 * userData: { kind, team, tier, height, radius, triangles, glows }.
 */
export const createBuildingModel = (kind: BuildingKind, team: Team, tier: Tier = 1, opts: BuildingModelOptions = {}): Object3D =>
  instance(getTemplate(kind, team, kind === 'tower' ? tier : 1), opts);

/** Cave-arch marker for the Roshan pit (opening faces +X). */
export const createRoshanPitModel = (opts: BuildingModelOptions = {}): Object3D => instance(getTemplate('roshan_pit', 'neutral', 1), opts);

const scaled = (o: Object3D, k: number): Object3D => {
  o.scale.setScalar(k);
  o.userData = { ...o.userData, height: (o.userData.height as number) * k, radius: (o.userData.radius as number) * k };
  return o;
};

/**
 * Generic decorative model for non-gameplay structures matched by name (real-map 'other'
 * entities: Moon Well, Ancient of Wind, Hunter's Hall, Ziggurat, Sacrificial Pit, Boneyard,
 * Circle of Power). Returns null for unknown names.
 */
export const createDecorModel = (name: string, team: Team, opts: BuildingModelOptions = {}): Object3D | null => {
  const n = name.toLowerCase();
  const t = (kind: TemplateKind, tm: Team): Object3D => instance(getTemplate(kind, tm, 1), opts);
  if (n.includes('moon well')) return scaled(t('fountain', 'sentinel'), 0.42);
  if (n.includes('ancient of')) return scaled(t('barracks_melee', 'sentinel'), 0.75);
  if (n.includes('hunter')) return scaled(t('barracks_ranged', 'sentinel'), 0.8);
  if (n.includes('ziggurat')) return t('ziggurat', 'scourge');
  if (n.includes('sacrificial')) return scaled(t('fountain', 'scourge'), 0.5);
  if (n.includes('boneyard') || n.includes('crypt')) return scaled(t('barracks_melee', 'scourge'), 0.75);
  if (n.includes('circle of power')) return t('circle_of_power', team);
  return null;
};

export const disposeBuildingCache = (): void => {
  for (const g of templates.values()) {
    g.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }
  templates.clear();
};
