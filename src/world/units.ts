// Procedural low-poly unit models (creeps, neutrals, Roshan, enemy heroes). Each model is a
// rigidly skinned SkinnedMesh (1 draw call) with code-driven idle/walk/attack/death animations.
// Models face +X (rotation.y = WC3 facing), feet at y = 0, heights in WC3 units.
import { BufferAttribute, BufferGeometry } from 'three';
import { boxB, box, coneB, crescent, cylB, dodeca, horn, ico, lathe, octa, sphere, torus } from './geom';
import type { PartOptions, V3, Xform } from './geom';
import { getPaintedMaterial } from './materials';
import { RigBuilder, bakeRig, instantiateRig } from './unitRig';
import type { AnimSpec, AnimatedModel, RigTemplate } from './unitRig';

export type { AnimName, AnimatedModel, PlayOptions } from './unitRig';

export const UNIT_MODEL_IDS = [
  'treant',
  'archer',
  'glaive_thrower',
  'ghoul',
  'necrolyte',
  'meat_wagon',
  'kobold',
  'centaur',
  'wolf',
  'ogre',
  'satyr',
  'troll',
  'golem',
  'dragon',
  'roshan',
  'pudge',
  'lion',
  'viper',
  'shadow_fiend',
  'lich',
] as const;

export type UnitModelId = (typeof UNIT_MODEL_IDS)[number];

/** Default model heights (WC3 units, feet → top). Creeps 90–120, heroes 120–160, Roshan 250. */
export const UNIT_MODEL_HEIGHTS: Record<UnitModelId, number> = {
  treant: 120,
  archer: 100,
  glaive_thrower: 110,
  ghoul: 95,
  necrolyte: 110,
  meat_wagon: 110,
  kobold: 90,
  centaur: 145,
  wolf: 90,
  ogre: 145,
  satyr: 115,
  troll: 125,
  golem: 140,
  dragon: 130,
  roshan: 250,
  pudge: 160,
  lion: 140,
  viper: 140,
  shadow_fiend: 160,
  lich: 150,
};

const ALIASES: Record<string, UnitModelId> = {
  sentinel_creep_melee: 'treant',
  sentinel_melee: 'treant',
  creep_goodguys_melee: 'treant',
  sentinel_creep_ranged: 'archer',
  sentinel_ranged: 'archer',
  creep_goodguys_ranged: 'archer',
  sentinel_creep_siege: 'glaive_thrower',
  sentinel_siege: 'glaive_thrower',
  glaive: 'glaive_thrower',
  scourge_creep_melee: 'ghoul',
  scourge_melee: 'ghoul',
  creep_badguys_melee: 'ghoul',
  scourge_creep_ranged: 'necrolyte',
  scourge_ranged: 'necrolyte',
  creep_badguys_ranged: 'necrolyte',
  scourge_creep_siege: 'meat_wagon',
  scourge_siege: 'meat_wagon',
  meatwagon: 'meat_wagon',
  nevermore: 'shadow_fiend',
  sf: 'shadow_fiend',
  shadowfiend: 'shadow_fiend',
  butcher: 'pudge',
  demon_witch: 'lion',
  netherdrake: 'viper',
  black_dragon: 'dragon',
  drake: 'dragon',
};

const KEYWORDS: Array<[string, UnitModelId]> = [
  ['roshan', 'roshan'],
  ['kobold', 'kobold'],
  ['centaur', 'centaur'],
  ['wolf', 'wolf'],
  ['ogre', 'ogre'],
  ['satyr', 'satyr'],
  ['troll', 'troll'],
  ['golem', 'golem'],
  ['dragon', 'dragon'],
  ['drake', 'dragon'],
  ['whelp', 'dragon'],
  ['harpy', 'dragon'],
  ['gnoll', 'kobold'],
  ['forest', 'troll'],
  ['mud', 'golem'],
  ['rock', 'golem'],
  ['treant', 'treant'],
  ['archer', 'archer'],
  ['ghoul', 'ghoul'],
  ['necro', 'necrolyte'],
  ['wagon', 'meat_wagon'],
  ['glaive', 'glaive_thrower'],
  ['pudge', 'pudge'],
  ['lion', 'lion'],
  ['viper', 'viper'],
  ['fiend', 'shadow_fiend'],
  ['lich', 'lich'],
];

/** Resolves any reasonable unit id ('sentinel_creep_melee', 'hero_pudge', 'neutral_kobold_taskmaster', …). */
export const resolveUnitModelId = (id: string): UnitModelId | null => {
  const n = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^(npc_dota_|npc_|hero_|neutral_|unit_)+/, '');
  if ((UNIT_MODEL_IDS as readonly string[]).includes(n)) return n as UnitModelId;
  const alias = ALIASES[n];
  if (alias) return alias;
  for (const [k, v] of KEYWORDS) if (n.includes(k)) return v;
  return null;
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Tapered straight limb between two model-space points. */
const limb = (r: RigBuilder, bone: string, from: V3, to: V3, r0: number, r1: number, color: number, o: Partial<PartOptions> = {}): void => {
  const d = sub(to, from);
  r.add(horn(d, [d[0] / 2, d[1] / 2, d[2] / 2], r0, r1, 1, 6), { p: from }, bone, { color, ...o });
};

/** Flat double-sided membrane (wings) as a triangle fan from the first point. */
const membrane = (pts: V3[]): BufferGeometry => {
  const v: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    v.push(...a, ...b, ...c, ...a, ...c, ...b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  return g;
};

/** Mirrors a point to the other side (left −Z ↔ right +Z). */
const mz = (p: V3, side: number): V3 => [p[0], p[1], p[2] * side];

interface BipedDims {
  hip: number;
  hipW: number;
  knee: number;
  kneeX?: number;
  ankle: number;
  chest: number;
  shoulder: number;
  shoulderW: number;
  shoulderX?: number;
  neck: number;
  headX?: number;
  elbow: number;
  elbowX?: number;
  hand: number;
  handX?: number;
  thigh: [number, number];
  shin: [number, number];
  upper: [number, number];
  fore: [number, number];
  handR: number;
  foot: [number, number, number];
  legColor: number;
  shinColor?: number;
  footColor: number;
  armColor: number;
  foreColor?: number;
  handColor: number;
  /** Hovering robed units: legs are skipped and a `robe` bone is added. */
  noLegs?: boolean;
}

const SIDES = [
  ['L', -1],
  ['R', 1],
] as const;

/** Standard biped skeleton + limbs. Bones: root, hips, chest, head, arm/fore L/R, leg/shin L/R. */
const biped = (d: BipedDims): RigBuilder => {
  const r = new RigBuilder();
  const sx = d.shoulderX ?? 0;
  r.bone('root', null, [0, 0, 0]);
  r.bone('hips', 'root', [0, d.hip, 0]);
  r.bone('chest', 'hips', [0, d.chest, 0]);
  r.bone('head', 'chest', [d.headX ?? 0, d.neck, 0]);
  if (d.noLegs) r.bone('robe', 'hips', [0, d.hip, 0]);
  for (const [S, z] of SIDES) {
    const sh: V3 = [sx, d.shoulder, z * d.shoulderW];
    const el: V3 = [sx + (d.elbowX ?? 2), d.elbow, z * (d.shoulderW + 1)];
    const ha: V3 = [sx + (d.handX ?? 4), d.hand, z * (d.shoulderW + 1)];
    r.bone(`arm${S}`, 'chest', sh).bone(`fore${S}`, `arm${S}`, el);
    limb(r, `arm${S}`, sh, el, d.upper[0], d.upper[1], d.armColor);
    limb(r, `fore${S}`, el, ha, d.fore[0], d.fore[1], d.foreColor ?? d.armColor);
    r.add(ico(d.handR, 0), { p: ha }, `fore${S}`, { color: d.handColor });
    if (d.noLegs) continue;
    const hp: V3 = [0, d.hip, z * d.hipW];
    const kn: V3 = [d.kneeX ?? 2, d.knee, z * d.hipW];
    const an: V3 = [0, d.ankle, z * d.hipW];
    r.bone(`leg${S}`, 'hips', hp).bone(`shin${S}`, `leg${S}`, kn);
    limb(r, `leg${S}`, hp, kn, d.thigh[0], d.thigh[1], d.legColor);
    limb(r, `shin${S}`, kn, an, d.shin[0], d.shin[1], d.shinColor ?? d.legColor);
    r.add(boxB(d.foot[0], d.foot[1], d.foot[2]), { p: [d.foot[0] * 0.25, 0, z * d.hipW] }, `shin${S}`, { color: d.footColor });
  }
  return r;
};

const handPos = (d: BipedDims, side: number): V3 => [(d.shoulderX ?? 0) + (d.handX ?? 4), d.hand, side * (d.shoulderW + 1)];

const add = (r: RigBuilder, bone: string, geo: BufferGeometry, t: Xform | undefined, color: number, o: Partial<PartOptions> = {}): void => {
  r.add(geo, t, bone, { color, ...o });
};

const eyes = (r: RigBuilder, bone: string, x: number, y: number, z: number, s: number, color: number): void => {
  for (const side of [-1, 1]) add(r, bone, box(s, s * 0.7, s), { p: [x, y, z * side] }, color, { emissive: 1.4 });
};

// ---------------------------------------------------------------------------
// Sentinel creeps
// ---------------------------------------------------------------------------

const BARK = 0x5c4838;
const LEAF = 0x3f8a3e;

const treant = (): [RigBuilder, number, AnimSpec] => {
  const d: BipedDims = {
    hip: 40, hipW: 13, knee: 22, ankle: 6, chest: 60, shoulder: 92, shoulderW: 25, neck: 102,
    elbow: 64, elbowX: 6, hand: 34, handX: 10, thigh: [11, 9], shin: [9, 11], upper: [8, 6], fore: [6, 4], handR: 7,
    foot: [26, 8, 18], legColor: BARK, footColor: 0x4a3a2c, armColor: BARK, handColor: 0x4a3a2c,
  };
  const r = biped(d);
  add(r, 'hips', lathe([[19, 0], [22, 12], [20, 22], [0, 24]], 7), { p: [0, 30, 0] }, BARK, { jitter: 1.5 });
  add(r, 'chest', lathe([[20, 0], [24, 18], [21, 40], [22, 52], [17, 60], [0, 62]], 7), { p: [0, 48, 0] }, BARK, { jitter: 2, grad: 0.35 });
  eyes(r, 'chest', 20, 88, 7, 4, 0xffe27a);
  add(r, 'chest', box(4, 3, 14), { p: [21, 79, 0] }, 0x1e140c);
  add(r, 'head', ico(23, 1), { p: [0, 112, 0], s: [1, 0.8, 1] }, LEAF, { jitter: 3, grad: 0.5 });
  add(r, 'head', ico(16, 1), { p: [-9, 122, 10], s: [1, 0.8, 1] }, 0x52a048, { jitter: 2.5, grad: 0.5 });
  add(r, 'head', ico(15, 1), { p: [6, 121, -11], s: [1, 0.8, 1] }, 0x52a048, { jitter: 2.5, grad: 0.5 });
  for (const [S, z] of SIDES) {
    add(r, `arm${S}`, ico(11, 0), { p: [0, 98, z * 26] }, LEAF, { jitter: 2 });
    const h = handPos(d, z);
    for (let i = -1; i <= 1; i++) r.add(horn([6, -16, i * 6], [3, -8, i * 3], 2.6, 0.4, 2, 4), { p: h }, `fore${S}`, { color: 0x4a3a2c });
  }
  return [r, 130, { type: 'biped', attack: 'smash', walkHz: 0.9, stride: 0.38, attackDur: 1.0 }];
};

const archer = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0x8c7ac8;
  const TEAL = 0x2f7a6a;
  const d: BipedDims = {
    hip: 48, hipW: 6, knee: 26, ankle: 5, chest: 62, shoulder: 76, shoulderW: 11, neck: 82,
    elbow: 62, hand: 48, handX: 5, thigh: [5, 4], shin: [4, 3], upper: [3.5, 3], fore: [3, 2.6], handR: 3,
    foot: [11, 5, 6], legColor: 0x3a3a6a, shinColor: 0x4a3a2c, footColor: 0x3a2a20, armColor: SKIN, foreColor: 0x4a3a2c, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', cylB(10, 13, 16, 7), { p: [0, 36, 0] }, TEAL);
  add(r, 'chest', cylB(10, 8, 22, 7), { p: [0, 54, 0] }, TEAL, { grad: 0.3 });
  add(r, 'chest', cylB(5, 5, 5, 6), { p: [0, 76, 0] }, SKIN);
  for (const [, z] of SIDES) add(r, 'chest', ico(5, 0), { p: [0, 77, z * 11] }, 0x4a8a7a);
  add(r, 'head', sphere(8.5, 8, 6), { p: [1, 88, 0] }, SKIN, { flat: false });
  add(r, 'head', ico(9.5, 0), { p: [-3, 91, 0], s: [1, 1, 0.95] }, 0x2a5a9a, { jitter: 1 });
  add(r, 'head', horn([-14, -22, 0], [-8, -6, 0], 3.5, 1, 3, 4), { p: [-8, 92, 0] }, 0x2a5a9a);
  for (const [, z] of SIDES) add(r, 'head', horn([-5, 9, z * 12], [-1, 3, z * 6], 2.2, 0.3, 2, 4), { p: [0, 89, z * 7] }, SKIN);
  eyes(r, 'head', 8, 89, 3, 2, 0xd8f8ff);
  // Bow in the left hand (held low; aims level when the arm rises), quiver on the back.
  const hl = handPos(d, -1);
  add(r, 'foreL', crescent(26, 4, 2.4, Math.PI * 0.95), { p: [hl[0] + 1, hl[1], hl[2]], r: [0, 0, -1.45] }, 0x6a4a30);
  add(r, 'chest', cylB(4, 4.5, 26, 6), { p: [-9, 54, 4], r: [0.25, 0, 0.2] }, 0x6a4a30);
  for (let i = 0; i < 3; i++) add(r, 'chest', box(1.5, 8, 1.5), { p: [-8 + i, 82, 5 + i * 1.5] }, 0xe8e0c8);
  return [r, 99, { type: 'biped', attack: 'bow', walkHz: 1.1, stride: 0.5, attackDur: 1.2 }];
};

const cart = (r: RigBuilder, wheelR: number, wx: number, wz: number, by: number): void => {
  r.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, by, 0]);
  for (const [name, x, z] of [
    ['wheelFL', wx, -wz],
    ['wheelFR', wx, wz],
    ['wheelBL', -wx, -wz],
    ['wheelBR', -wx, wz],
  ] as const) {
    r.bone(name, 'body', [x, wheelR, z]);
  }
};

const glaiveThrower = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const WOOD = 0x6a4a3c;
  const SILVER = 0xc8d2ee;
  cart(r, 17, 34, 32, 30);
  r.bone('arm', 'body', [-6, 50, 0]).bone('glaive', 'arm', [30, 64, 0]);
  add(r, 'body', boxB(112, 14, 52), { p: [0, 20, 0] }, WOOD, { jitter: 1 });
  add(r, 'body', boxB(116, 8, 8), { p: [0, 34, -26] }, 0x8c6a50);
  add(r, 'body', boxB(116, 8, 8), { p: [0, 34, 26] }, 0x8c6a50);
  add(r, 'body', crescent(24, 8, 4, Math.PI), { p: [44, 40, 0], r: [0, Math.PI / 2, Math.PI / 2] }, SILVER);
  add(r, 'body', boxB(30, 20, 24), { p: [-6, 34, 0] }, 0x5a3a30);
  add(r, 'body', box(40, 30, 2), { p: [-30, 50, -27] }, 0x4a3a7a);
  for (const w of ['wheelFL', 'wheelFR', 'wheelBL', 'wheelBR']) {
    const z = w.endsWith('L') ? -32 : 32;
    const x = w.startsWith('wheelF') ? 34 : -34;
    add(r, w, cylB(17, 17, 6, 10), { p: [x, 17, z], r: [Math.PI / 2, 0, 0] }, 0x4a3426);
    add(r, w, cylB(5, 5, 8, 6), { p: [x, 17, z], r: [Math.PI / 2, 0, 0] }, SILVER);
    add(r, w, box(30, 3, 3), { p: [x, 17, z * 1.06] }, 0x6a4a30);
  }
  // Ballista: rail + horizontal bow arms.
  add(r, 'arm', box(76, 7, 10), { p: [8, 56, 0], r: [0, 0, 0.3] }, WOOD);
  add(r, 'arm', crescent(36, 6, 5, Math.PI * 0.9), { p: [10, 60, 0], r: [Math.PI / 2, 0, Math.PI] }, SILVER);
  // Moon glaive: three crescent blades.
  for (let i = 0; i < 3; i++) add(r, 'glaive', crescent(15, 6, 2, Math.PI * 1.1), { p: [30, 64, 0], r: [(i / 3) * Math.PI * 2, Math.PI / 2, 0] }, SILVER, { emissive: 0.25 });
  return [r, 92, { type: 'cart', attack: 'recoil', walkHz: 1, stride: 0, attackDur: 2.2 }];
};

// ---------------------------------------------------------------------------
// Scourge creeps
// ---------------------------------------------------------------------------

const GHOUL = 0x8a9a80;

const ghoul = (): [RigBuilder, number, AnimSpec] => {
  const d: BipedDims = {
    hip: 40, hipW: 9, knee: 22, kneeX: 7, ankle: 6, chest: 52, shoulder: 66, shoulderW: 15, shoulderX: 12, neck: 68, headX: 20,
    elbow: 44, elbowX: 6, hand: 24, handX: 14, thigh: [6, 4.5], shin: [4.5, 3.5], upper: [5, 4], fore: [4, 3], handR: 4.5,
    foot: [14, 4, 7], legColor: GHOUL, footColor: 0x6a7860, armColor: GHOUL, handColor: 0x6a7860,
  };
  const r = biped(d);
  add(r, 'hips', ico(12, 0), { p: [2, 44, 0] }, 0x4a3a2a, { jitter: 1 });
  add(r, 'chest', ico(17, 1), { p: [9, 62, 0], s: [1.25, 0.9, 1] }, GHOUL, { jitter: 1.5, grad: 0.4 });
  for (let i = 0; i < 4; i++) add(r, 'chest', horn([-4, 8, 0], [-2, 4, 0], 2.4, 0.3, 2, 4), { p: [2 + i * 5, 74 - i * 1.5, 0] }, 0xd8ccac);
  add(r, 'head', sphere(9.5, 7, 5), { p: [28, 70, 0], s: [1.2, 0.9, 0.95] }, GHOUL);
  add(r, 'head', boxB(12, 5, 12), { p: [34, 60, 0] }, 0x5a6a50);
  for (const [, z] of SIDES) {
    add(r, 'head', box(2, 4, 1.5), { p: [38, 64, z * 4] }, 0xe8e0c8);
    add(r, 'head', horn([-6, 10, z * 6], [-2, 4, z * 3], 2.5, 0.3, 2, 4), { p: [24, 76, z * 6] }, GHOUL);
  }
  eyes(r, 'head', 37, 72, 4, 2.4, 0xb8ff4a);
  for (const [S, z] of SIDES) {
    const h = handPos(d, z);
    for (let i = -1; i <= 1; i++) r.add(horn([10, -6, i * 4], [6, -1, i * 2], 1.5, 0.2, 2, 3), { p: h }, `fore${S}`, { color: 0xe0d8c0 });
  }
  return [r, 84, { type: 'biped', attack: 'claw', walkHz: 1.35, stride: 0.55, attackDur: 0.9 }];
};

const necrolyte = (): [RigBuilder, number, AnimSpec] => {
  const ROBE = 0x2c1c40;
  const d: BipedDims = {
    hip: 46, hipW: 8, knee: 24, ankle: 5, chest: 62, shoulder: 84, shoulderW: 13, neck: 88, headX: 2,
    elbow: 66, elbowX: 6, hand: 52, handX: 12, thigh: [5, 4], shin: [4, 3], upper: [5, 4.5], fore: [4.5, 3.5], handR: 4,
    foot: [10, 4, 6], legColor: ROBE, footColor: ROBE, armColor: ROBE, handColor: 0x9cff5a, noLegs: true,
  };
  const r = biped(d);
  add(r, 'robe', lathe([[27, 2], [22, 24], [16, 42], [0, 47]], 8), undefined, ROBE, { jitter: 1.2, grad: 0.4 });
  add(r, 'robe', torus(26, 2.5, 3, 8), { p: [0, 4, 0] }, 0x6a3a8a);
  add(r, 'chest', cylB(12, 15, 32, 7), { p: [0, 50, 0] }, 0x3a2452, { grad: 0.3 });
  for (const [, z] of SIDES) {
    add(r, 'chest', ico(7, 0), { p: [0, 84, z * 13] }, 0x241634);
    add(r, 'chest', horn([0, 14, z * 3], [0, 7, z * 2], 2.4, 0.3, 2, 4), { p: [-3, 84, z * 8] }, 0xd8ccac);
  }
  add(r, 'head', ico(12.5, 1), { p: [-1, 93, 0], s: [1, 1.12, 1] }, ROBE, { jitter: 0.8 });
  add(r, 'head', sphere(7.5, 7, 5), { p: [6, 90, 0] }, 0xd8ccb0);
  eyes(r, 'head', 12.5, 91, 2.6, 2, 0x8cff4a);
  for (const [S, z] of SIDES) {
    const h = handPos(d, z);
    r.add(ico(5.5, 0), { p: h }, `fore${S}`, { color: 0x9cff5a, emissive: 1.4 });
  }
  return [r, 105, { type: 'hover', attack: 'cast', walkHz: 1, stride: 0, attackDur: 1.4, hover: 0.05 }];
};

const meatWagon = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const WOOD = 0x4a3a32;
  const BONE = 0xd8ccac;
  cart(r, 20, 34, 34, 30);
  r.bone('arm', 'body', [-4, 48, 0]);
  add(r, 'body', boxB(120, 18, 58), { p: [0, 22, 0] }, WOOD, { jitter: 1.5 });
  for (const z of [-30, 30]) {
    for (let i = 0; i < 4; i++) add(r, 'body', horn([0, 16, z * 0.35], [0, 8, z * 0.1], 3, 0.3, 2, 4), { p: [-40 + i * 26, 38, z] }, BONE);
    add(r, 'body', boxB(10, 26, 6), { p: [-4, 38, z * 0.55] }, 0x3a2a24);
  }
  add(r, 'body', sphere(10, 6, 5), { p: [62, 32, 0] }, BONE);
  eyes(r, 'body', 70, 34, 4, 2.5, 0x8cff4a);
  for (const w of ['wheelFL', 'wheelFR', 'wheelBL', 'wheelBR']) {
    const z = w.endsWith('L') ? -34 : 34;
    const x = w.startsWith('wheelF') ? 34 : -34;
    add(r, w, cylB(20, 20, 7, 9), { p: [x, 20, z], r: [Math.PI / 2, 0, 0] }, 0x3a2c26);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(r, w, horn([Math.cos(a) * 9, Math.sin(a) * 9, 0], [Math.cos(a) * 4, Math.sin(a) * 4, 0], 2.2, 0.2, 1, 3), { p: [x + Math.cos(a) * 20, 20 + Math.sin(a) * 20, z] }, BONE);
    }
  }
  // Catapult arm rests pointing backward; basket of meat at its end.
  limb(r, 'arm', [-4, 48, 0], [-62, 60, 0], 4, 3, 0x5a4034);
  add(r, 'arm', lathe([[0, 0], [12, 2], [15, 10], [13, 12]], 7), { p: [-62, 56, 0] }, 0x3a2c26);
  add(r, 'arm', ico(9, 0), { p: [-62, 70, 2] }, 0xa0404a, { jitter: 1.5 });
  add(r, 'arm', ico(7, 0), { p: [-56, 72, -5] }, 0xc06060, { jitter: 1.2 });
  add(r, 'arm', ico(6, 0), { p: [-68, 73, 5] }, 0x8a3040, { jitter: 1 });
  return [r, 88, { type: 'cart', attack: 'launch', walkHz: 1, stride: 0, attackDur: 2.4 }];
};

// ---------------------------------------------------------------------------
// Neutrals
// ---------------------------------------------------------------------------

const kobold = (): [RigBuilder, number, AnimSpec] => {
  const FUR = 0x8a6a4a;
  const d: BipedDims = {
    hip: 30, hipW: 6, knee: 16, ankle: 4, chest: 40, shoulder: 52, shoulderW: 10, neck: 54, headX: 4,
    elbow: 40, hand: 28, handX: 5, thigh: [4.5, 3.5], shin: [3.5, 3], upper: [3.5, 3], fore: [3, 2.6], handR: 3,
    foot: [10, 4, 6], legColor: FUR, footColor: 0x5a4a3a, armColor: FUR, handColor: FUR,
  };
  const r = biped(d);
  add(r, 'hips', cylB(9, 10, 12, 6), { p: [0, 26, 0] }, 0x5a4a6a);
  add(r, 'chest', ico(11, 0), { p: [1, 46, 0], s: [1, 1.1, 1] }, 0x6a5a7a, { jitter: 1 });
  add(r, 'head', ico(10, 1), { p: [6, 62, 0] }, FUR, { jitter: 0.8 });
  add(r, 'head', coneB(5, 12, 6), { p: [14, 59, 0], r: [0, 0, -Math.PI / 2] }, 0x9a7a5a);
  for (const [, z] of SIDES) add(r, 'head', horn([-3, 10, z * 7], [0, 5, z * 3], 3, 0.5, 2, 4), { p: [4, 66, z * 6] }, FUR);
  eyes(r, 'head', 13, 64, 3.5, 2, 0xffd040);
  add(r, 'head', cylB(10, 11, 5, 7), { p: [4, 69, 0] }, 0x7a7068);
  add(r, 'head', cylB(2.5, 2.5, 8, 5), { p: [4, 74, 0] }, 0xf0e8c8);
  add(r, 'head', octa(2.5), { p: [4, 84, 0], s: [1, 1.8, 1] }, 0xffc040, { emissive: 1.6 });
  const h = handPos(d, 1);
  limb(r, 'foreR', [h[0], h[1] - 6, h[2]], [h[0] + 2, h[1] + 30, h[2]], 1.6, 1.4, 0x6a4a30);
  add(r, 'foreR', horn([12, -4, 0], [6, 2, 0], 2.2, 0.3, 2, 4), { p: [h[0] + 2, h[1] + 28, h[2]] }, 0x9a9aa2);
  add(r, 'foreR', horn([-10, -4, 0], [-5, 2, 0], 2.2, 0.3, 2, 4), { p: [h[0] + 2, h[1] + 28, h[2]] }, 0x9a9aa2);
  return [r, 82, { type: 'biped', attack: 'swing', walkHz: 1.4, stride: 0.6, attackDur: 0.9 }];
};

const centaur = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const HORSE = 0x7a5434;
  const SKIN = 0x9a7050;
  r.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, 62, 0]);
  for (const [n, x, z] of [['legFL', 28, -10], ['legFR', 28, 10], ['legBL', -30, -10], ['legBR', -30, 10]] as const) {
    r.bone(n, 'body', [x, 56, z]);
    limb(r, n, [x, 58, z], [x + 2, 28, z], 6.5, 4.5, HORSE);
    limb(r, n, [x + 2, 28, z], [x, 6, z], 4.5, 3.5, HORSE);
    add(r, n, cylB(5, 5.5, 6, 6), { p: [x, 0, z] }, 0x2a2420);
  }
  r.bone('tail', 'body', [-44, 66, 0]).bone('chest', 'body', [30, 74, 0]).bone('head', 'chest', [36, 116, 0]);
  add(r, 'body', ico(30, 1), { p: [-2, 64, 0], s: [1.55, 0.72, 0.72] }, HORSE, { jitter: 1.5, grad: 0.35 });
  add(r, 'tail', horn([-18, -40, 0], [-14, -6, 0], 5, 1.5, 3, 5), { p: [-44, 68, 0] }, 0x3a2a1c);
  add(r, 'chest', cylB(12, 15, 34, 7), { p: [30, 72, 0] }, SKIN, { grad: 0.3 });
  add(r, 'chest', cylB(15, 16, 8, 7), { p: [30, 72, 0] }, 0x6a3a28);
  add(r, 'chest', ico(16, 0), { p: [32, 102, 0], s: [1, 0.8, 1.2] }, SKIN, { jitter: 1 });
  for (const [S, z] of SIDES) {
    const sh: V3 = [33, 108, z * 18];
    const el: V3 = [37, 88, z * 21];
    const ha: V3 = [42, 70, z * 21];
    r.bone(`arm${S}`, 'chest', sh).bone(`fore${S}`, `arm${S}`, el);
    limb(r, `arm${S}`, sh, el, 6, 5, SKIN);
    limb(r, `fore${S}`, el, ha, 5, 4, SKIN);
    add(r, `fore${S}`, ico(5, 0), { p: ha }, SKIN);
    add(r, `arm${S}`, ico(9, 0), { p: [32, 112, z * 19], s: [1, 0.6, 1] }, 0x6a3a28);
    add(r, `arm${S}`, horn([0, 12, z * 4], [0, 6, z * 2], 3, 0.3, 2, 4), { p: [32, 116, z * 19] }, 0xd8ccac);
  }
  add(r, 'head', sphere(9.5, 7, 6), { p: [40, 124, 0] }, SKIN);
  add(r, 'head', box(14, 6, 3), { p: [37, 136, 0] }, 0x2a1a10);
  for (const [, z] of SIDES) add(r, 'head', horn([4, 7, z * 1], [3, 3, 0], 1.6, 0.2, 2, 3), { p: [47, 118, z * 4] }, 0xe8e0c8);
  eyes(r, 'head', 48, 126, 3.5, 2, 0xffa040);
  // Great war-axe.
  limb(r, 'foreR', [42, 50, 22], [42, 116, 22], 2, 2, 0x5a3a24);
  add(r, 'foreR', crescent(18, 10, 3, Math.PI * 0.9), { p: [32, 108, 22], r: [0, 0, 0] }, 0xa0a0a8);
  return [r, 134, { type: 'quad', attack: 'swing', walkHz: 1.2, stride: 0.45, attackDur: 1.1 }];
};

const quadBase = (r: RigBuilder, bodyY: number, legX: number, legZ: number): void => {
  r.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, bodyY, 0]);
  for (const [n, x, z] of [['legFL', legX, -legZ], ['legFR', legX, legZ], ['legBL', -legX, -legZ], ['legBR', -legX, legZ]] as const) {
    r.bone(n, 'body', [x, bodyY - 4, z]);
  }
};

const wolf = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const FUR = 0x6a6a76;
  quadBase(r, 46, 24, 9);
  r.bone('neck', 'body', [28, 52, 0]).bone('head', 'neck', [42, 60, 0]).bone('tail', 'body', [-34, 50, 0]);
  add(r, 'body', ico(22, 1), { p: [0, 46, 0], s: [1.6, 0.78, 0.72] }, FUR, { jitter: 1.5, grad: 0.4 });
  add(r, 'body', ico(16, 0), { p: [22, 46, 0], s: [1, 1.1, 1] }, 0x8a8a96, { jitter: 1.5 });
  for (const [n, x, z] of [['legFL', 24, -9], ['legFR', 24, 9], ['legBL', -24, -9], ['legBR', -24, 9]] as const) {
    limb(r, n, [x, 44, z], [x + (x > 0 ? 2 : -3), 20, z], 5, 3.5, FUR);
    limb(r, n, [x + (x > 0 ? 2 : -3), 20, z], [x, 3, z], 3.5, 2.5, FUR);
    add(r, n, boxB(8, 4, 5), { p: [x + 2, 0, z] }, 0x3a3a40);
  }
  limb(r, 'neck', [26, 50, 0], [42, 60, 0], 9, 7, FUR);
  add(r, 'head', ico(10, 1), { p: [46, 62, 0], s: [1.15, 0.9, 0.9] }, FUR);
  add(r, 'head', coneB(5.5, 15, 6), { p: [54, 59, 0], r: [0, 0, -Math.PI / 2] }, 0x7a7a86);
  add(r, 'head', box(4, 3, 3), { p: [68, 59, 0] }, 0x1a1a1a);
  for (const [, z] of SIDES) add(r, 'head', horn([-2, 10, z * 2], [0, 5, z], 2.8, 0.3, 2, 4), { p: [42, 68, z * 5] }, FUR);
  eyes(r, 'head', 54, 64, 3.5, 2, 0xffd040);
  add(r, 'tail', horn([-22, 10, 0], [-12, 0, 0], 4.5, 1, 3, 5), { p: [-34, 50, 0] }, FUR);
  return [r, 76, { type: 'quad', attack: 'bite', walkHz: 1.6, stride: 0.6, attackDur: 0.9 }];
};

const ogre = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0xb08a5a;
  const d: BipedDims = {
    hip: 52, hipW: 17, knee: 28, ankle: 6, chest: 80, shoulder: 110, shoulderW: 34, neck: 116, headX: 10,
    elbow: 82, elbowX: 6, hand: 50, handX: 10, thigh: [12, 10], shin: [10, 9], upper: [11, 9], fore: [9, 8], handR: 9,
    foot: [26, 8, 16], legColor: SKIN, footColor: 0x5a4030, armColor: SKIN, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', cylB(26, 30, 22, 8), { p: [0, 44, 0] }, 0x6a4a2a, { jitter: 1 });
  add(r, 'chest', ico(38, 1), { p: [6, 84, 0], s: [1, 1.05, 1.1] }, SKIN, { jitter: 2, grad: 0.35 });
  add(r, 'chest', ico(16, 0), { p: [0, 112, -32], s: [1, 0.6, 1] }, 0x6a6a72);
  add(r, 'head', sphere(15, 7, 6), { p: [16, 126, 0] }, SKIN);
  for (const [, z] of SIDES) add(r, 'head', horn([3, 8, z * 1], [2, 3, 0], 2.4, 0.3, 2, 4), { p: [28, 118, z * 6] }, 0xe8e0c8);
  eyes(r, 'head', 29, 130, 5, 3, 0xff5030);
  add(r, 'head', box(6, 4, 20), { p: [24, 139, 0] }, 0x3a2a1a);
  const h = handPos(d, 1);
  r.add(horn([18, 64, 0], [8, 30, 0], 6, 12, 3, 6), { p: [h[0], h[1] - 4, h[2]] }, 'foreR', { color: 0x5a3e28, jitter: 1.5 });
  return [r, 141, { type: 'biped', attack: 'smash', walkHz: 0.9, stride: 0.4, attackDur: 1.3 }];
};

const satyr = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0x9a5a7a;
  const FUR = 0x6a4a3a;
  const d: BipedDims = {
    hip: 50, hipW: 8, knee: 30, kneeX: 8, ankle: 9, chest: 68, shoulder: 86, shoulderW: 14, neck: 90, headX: 4,
    elbow: 68, elbowX: 4, hand: 52, handX: 8, thigh: [7, 5], shin: [4.5, 3.5], upper: [4.5, 3.8], fore: [3.8, 3.2], handR: 4,
    foot: [8, 9, 6], legColor: FUR, footColor: 0x1e1814, armColor: SKIN, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', ico(13, 0), { p: [0, 52, 0], s: [1, 0.8, 1] }, FUR, { jitter: 1.5 });
  add(r, 'chest', cylB(15, 11, 30, 7), { p: [2, 62, 0] }, SKIN, { grad: 0.3 });
  add(r, 'head', sphere(9, 7, 6), { p: [8, 98, 0] }, SKIN);
  add(r, 'head', coneB(4, 10, 5), { p: [10, 88, 0], r: [0, 0, 0.3] }, 0x3a2a24);
  for (const [, z] of SIDES) add(r, 'head', horn([-14, 6, z * 10], [-2, 14, z * 6], 3.2, 0.5, 4, 4), { p: [4, 104, z * 5] }, 0x2a2420);
  eyes(r, 'head', 15, 100, 3, 2, 0xffe040);
  for (const [S, z] of SIDES) {
    const h = handPos(d, z);
    for (let i = -1; i <= 1; i++) r.add(horn([8, -6, i * 3], [4, -1, i], 1.3, 0.2, 2, 3), { p: h }, `fore${S}`, { color: 0x2a2420 });
  }
  r.bone('tail', 'hips', [-8, 52, 0]);
  add(r, 'tail', horn([-14, -16, 0], [-12, 0, 0], 2, 0.6, 3, 4), { p: [-8, 52, 0] }, FUR);
  return [r, 110, { type: 'biped', attack: 'claw', walkHz: 1.3, stride: 0.55, attackDur: 0.9 }];
};

const troll = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0x4a8aa8;
  const d: BipedDims = {
    hip: 56, hipW: 8, knee: 30, ankle: 5, chest: 74, shoulder: 96, shoulderW: 14, neck: 100, headX: 6,
    elbow: 72, elbowX: 4, hand: 50, handX: 8, thigh: [5, 4], shin: [4, 3], upper: [4, 3.5], fore: [3.5, 3], handR: 4,
    foot: [14, 4, 6], legColor: SKIN, footColor: SKIN, armColor: SKIN, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', cylB(10, 12, 14, 6), { p: [0, 50, 0] }, 0x6a4a2a);
  add(r, 'chest', cylB(12, 9, 30, 7), { p: [0, 66, 0] }, SKIN, { grad: 0.3 });
  add(r, 'chest', torus(11, 2, 3, 8), { p: [0, 92, 0] }, 0xd8ccac);
  add(r, 'head', sphere(9, 7, 6), { p: [10, 106, 0], s: [1.1, 1, 0.9] }, SKIN);
  add(r, 'head', coneB(3.5, 10, 5), { p: [18, 104, 0], r: [0, 0, -1.3] }, SKIN);
  for (const [, z] of SIDES) {
    add(r, 'head', horn([6, 10, z * 2], [5, 2, 0], 2, 0.3, 2, 4), { p: [16, 98, z * 5] }, 0xe8e0c8);
    add(r, 'head', horn([-6, 3, z * 12], [-2, 2, z * 6], 2.4, 0.3, 2, 4), { p: [8, 106, z * 7] }, SKIN);
  }
  add(r, 'head', box(18, 8, 3), { p: [6, 117, 0] }, 0xc0402a, { jitter: 1 });
  eyes(r, 'head', 18, 108, 3, 2, 0xffe060);
  const h = handPos(d, 1);
  limb(r, 'foreR', [h[0] - 4, h[1] - 30, h[2]], [h[0] + 4, h[1] + 60, h[2]], 1.5, 1.3, 0x6a4a30);
  add(r, 'foreR', coneB(3.5, 14, 4), { p: [h[0] + 4, h[1] + 60, h[2]], r: [0, 0, -0.09] }, 0xb0b0b8);
  return [r, 120, { type: 'biped', attack: 'swing', walkHz: 1.1, stride: 0.5, attackDur: 1.0 }];
};

const golem = (): [RigBuilder, number, AnimSpec] => {
  const ROCK = 0x7a766c;
  const MOSS = 0x4a6a3a;
  const d: BipedDims = {
    hip: 46, hipW: 18, knee: 24, ankle: 6, chest: 72, shoulder: 100, shoulderW: 34, neck: 108, headX: 12,
    elbow: 72, elbowX: 6, hand: 38, handX: 12, thigh: [11, 9], shin: [9, 9], upper: [10, 9], fore: [10, 9], handR: 15,
    foot: [24, 8, 18], legColor: ROCK, footColor: 0x5a5650, armColor: ROCK, handColor: 0x6a665e,
  };
  const r = biped(d);
  add(r, 'hips', dodeca(22), { p: [0, 48, 0], s: [1.2, 0.8, 1.1] }, ROCK, { jitter: 2 });
  add(r, 'chest', dodeca(34), { p: [2, 84, 0], s: [1, 0.95, 1.15] }, ROCK, { jitter: 3, grad: 0.35 });
  for (const [, z] of SIDES) add(r, 'chest', dodeca(15), { p: [0, 104, z * 30] }, MOSS, { jitter: 2 });
  for (let i = 0; i < 3; i++) add(r, 'chest', box(3, 12, 2), { p: [33, 74 + i * 9, -8 + i * 8], r: [0, 0, 0.4 * (i - 1)] }, 0xff8a3a, { emissive: 1.3 });
  add(r, 'head', dodeca(14), { p: [18, 114, 0] }, ROCK, { jitter: 1.5 });
  eyes(r, 'head', 30, 116, 5, 3, 0xffa040);
  return [r, 126, { type: 'biped', attack: 'smash', walkHz: 0.8, stride: 0.35, attackDur: 1.3 }];
};

const wing = (r: RigBuilder, side: 'L' | 'R', root: V3, span: number, color: number, boneColor: number): void => {
  const z = side === 'L' ? -1 : 1;
  const raw: V3[] = [
    [0, 0, 0],
    [-span * 0.15, span * 0.42, -span * 0.55],
    [-span * 0.45, span * 0.18, -span],
    [-span * 0.6, -span * 0.1, -span * 0.75],
    [-span * 0.55, -span * 0.15, -span * 0.35],
    [-span * 0.3, -span * 0.08, -span * 0.08],
  ];
  const pts = raw.map((p) => mz(p, -z));
  const abs = pts.map((p) => [p[0] + root[0], p[1] + root[1], p[2] + root[2]] as V3);
  r.add(membrane(abs), undefined, `wing${side}`, { color, shade: 0.05, grad: 0.2 });
  for (const tip of [pts[1]!, pts[2]!, pts[3]!]) {
    r.add(horn(tip, [tip[0] * 0.5, tip[1] * 0.6 + 2, tip[2] * 0.5], span * 0.04, span * 0.01, 2, 4), { p: root }, `wing${side}`, { color: boneColor });
  }
};

const dragon = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const SCALE = 0x2f2a3c;
  quadBase(r, 50, 22, 12);
  r.bone('neck', 'body', [30, 58, 0]).bone('head', 'neck', [56, 90, 0]).bone('tail', 'body', [-34, 54, 0]);
  r.bone('wingL', 'body', [6, 64, -12]).bone('wingR', 'body', [6, 64, 12]);
  add(r, 'body', ico(24, 1), { p: [0, 52, 0], s: [1.5, 0.85, 0.9] }, SCALE, { jitter: 1.5, grad: 0.4 });
  add(r, 'body', ico(18, 0), { p: [6, 42, 0], s: [1.6, 0.6, 0.8] }, 0x9a6a3a);
  for (let i = 0; i < 5; i++) add(r, 'body', horn([0, 9, 0], [-2, 5, 0], 3, 0.3, 2, 4), { p: [-20 + i * 9, 70 - Math.abs(i - 2), 0] }, 0x4a3a50);
  for (const [n, x, z] of [['legFL', 22, -12], ['legFR', 22, 12], ['legBL', -22, -12], ['legBR', -22, 12]] as const) {
    limb(r, n, [x, 46, z], [x + 4, 22, z * 1.1], 6, 4.5, SCALE);
    limb(r, n, [x + 4, 22, z * 1.1], [x, 4, z * 1.1], 4.5, 3, SCALE);
    for (let i = -1; i <= 1; i++) add(r, n, horn([7, -3, i * 3], [4, 0, i], 1.4, 0.2, 2, 3), { p: [x, 4, z * 1.1] }, 0xd8ccac);
  }
  limb(r, 'neck', [28, 58, 0], [54, 88, 0], 9, 6.5, SCALE);
  add(r, 'head', ico(10, 1), { p: [62, 92, 0], s: [1.7, 0.75, 0.8] }, SCALE);
  add(r, 'head', boxB(16, 3, 10), { p: [70, 84, 0] }, 0x4a3a50);
  for (const [, z] of SIDES) add(r, 'head', horn([-14, 8, z * 5], [-6, 6, z * 2], 2.6, 0.3, 3, 4), { p: [56, 98, z * 5] }, 0xd8ccac);
  eyes(r, 'head', 70, 95, 5, 2.5, 0xff8a20);
  add(r, 'tail', horn([-50, -24, 0], [-28, 4, 0], 9, 1, 4, 5), { p: [-34, 54, 0] }, SCALE);
  wing(r, 'L', [6, 64, -12], 62, 0x4a2a4a, 0x2a2430);
  wing(r, 'R', [6, 64, 12], 62, 0x4a2a4a, 0x2a2430);
  return [r, 104, { type: 'quad', attack: 'bite', walkHz: 1.2, stride: 0.45, attackDur: 1.1 }];
};

const roshan = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0x6e4a3a;
  const BONE = 0xd8ccac;
  const d: BipedDims = {
    hip: 90, hipW: 30, knee: 50, ankle: 10, chest: 130, shoulder: 190, shoulderW: 58, shoulderX: 10, neck: 190, headX: 40,
    elbow: 120, elbowX: 18, hand: 50, handX: 34, thigh: [22, 18], shin: [18, 16], upper: [22, 17], fore: [18, 15], handR: 22,
    foot: [44, 14, 30], legColor: SKIN, footColor: 0x3a2a24, armColor: SKIN, handColor: 0x5a3a2e,
  };
  const r = biped(d);
  add(r, 'hips', ico(42, 1), { p: [0, 96, 0], s: [1.1, 0.8, 1.15] }, SKIN, { jitter: 3 });
  add(r, 'chest', ico(72, 1), { p: [12, 160, 0], s: [1.1, 0.95, 1.1] }, SKIN, { jitter: 4, grad: 0.4 });
  add(r, 'chest', ico(44, 0), { p: [50, 140, 0], s: [0.8, 1.1, 1.1] }, 0x8a6a50, { jitter: 3 });
  for (let i = 0; i < 6; i++) add(r, 'chest', horn([-16, 40, 0], [-4, 22, 0], 9, 0.8, 3, 5), { p: [-40 + i * 12, 210 - Math.abs(i - 2) * 12, 0] }, BONE);
  for (const [, z] of SIDES) add(r, 'chest', ico(30, 0), { p: [10, 200, z * 54], s: [1.2, 0.6, 1] }, 0x8a7a6a, { jitter: 3 });
  add(r, 'head', ico(28, 1), { p: [60, 198, 0], s: [1.15, 0.9, 1] }, SKIN, { jitter: 2 });
  add(r, 'head', boxB(30, 14, 34), { p: [74, 176, 0] }, 0x5a3a2e);
  for (const [, z] of SIDES) {
    add(r, 'head', horn([30, 46, z * 40], [-10, 40, z * 26], 9, 1, 6, 6), { p: [54, 214, z * 16] }, BONE);
    add(r, 'head', horn([10, 18, z * 3], [8, 6, 0], 4, 0.4, 3, 4), { p: [84, 180, z * 12] }, BONE);
  }
  eyes(r, 'head', 86, 204, 10, 5, 0xff4a20);
  r.bone('tail', 'hips', [-36, 96, 0]);
  add(r, 'tail', horn([-70, -60, 0], [-50, -6, 0], 14, 2, 4, 6), { p: [-36, 96, 0] }, SKIN);
  return [r, 250, { type: 'biped', attack: 'smash', walkHz: 0.7, stride: 0.3, attackDur: 1.5 }];
};

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------

const pudge = (): [RigBuilder, number, AnimSpec] => {
  const SKIN = 0xa0ae8c;
  const d: BipedDims = {
    hip: 56, hipW: 18, knee: 30, ankle: 6, chest: 90, shoulder: 126, shoulderW: 40, neck: 132, headX: 14,
    elbow: 96, elbowX: 8, hand: 64, handX: 14, thigh: [12, 10], shin: [10, 9], upper: [11, 9], fore: [9, 8], handR: 8,
    foot: [26, 8, 16], legColor: 0x5a4a3a, footColor: 0x3a2a20, armColor: SKIN, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', cylB(28, 30, 22, 8), { p: [0, 48, 0] }, 0x5a4a3a);
  add(r, 'chest', ico(48, 1), { p: [10, 92, 0], s: [1, 1, 1.12] }, SKIN, { jitter: 2, grad: 0.35 });
  for (let i = 0; i < 4; i++) add(r, 'chest', box(2, 26, 2), { p: [56, 84 + i * 2, -18 + i * 12], r: [0.3 * (i - 1.5), 0, 0] }, 0x3a3a30);
  add(r, 'hips', box(4, 46, 40), { p: [44, 50, 0], r: [0, 0, 0.12] }, 0x7a3a2a);
  for (const [, z] of SIDES) {
    add(r, 'chest', ico(18, 0), { p: [0, 128, z * 38], s: [1.2, 0.6, 1] }, 0x6a5a50, { jitter: 1.5 });
    add(r, 'chest', horn([10, 20, z * 6], [4, 12, 0], 3, 0.3, 3, 4), { p: [-20, 120, z * 20] }, 0x9a9aa2);
  }
  add(r, 'head', sphere(16, 8, 6), { p: [26, 140, 0] }, SKIN);
  add(r, 'head', boxB(14, 8, 18), { p: [36, 126, 0] }, 0x8a9a7a);
  eyes(r, 'head', 40, 144, 6, 3, 0xffe060);
  add(r, 'head', cylB(17, 17, 6, 8), { p: [26, 148, 0] }, 0x7a3a2a);
  // Meat hook on a chain (right), cleaver (left).
  const hr = handPos(d, 1);
  for (let i = 0; i < 4; i++) add(r, 'foreR', torus(3, 1, 3, 6), { p: [hr[0] + 2, hr[1] - 8 - i * 6, hr[2]], r: [i % 2 ? Math.PI / 2 : 0, 0, 0] }, 0x8a8a90);
  add(r, 'foreR', horn([14, 16, 0], [18, -6, 0], 3.5, 0.6, 5, 5), { p: [hr[0] + 2, hr[1] - 32, hr[2]] }, 0xa0a0a8);
  const hl = handPos(d, -1);
  limb(r, 'foreL', [hl[0], hl[1], hl[2]], [hl[0] + 4, hl[1] - 16, hl[2]], 2, 2, 0x4a3a2a);
  add(r, 'foreL', box(26, 18, 2), { p: [hl[0] + 12, hl[1] - 28, hl[2]] }, 0x9a9aa4);
  return [r, 156, { type: 'biped', attack: 'hook', walkHz: 0.9, stride: 0.38, attackDur: 1.2 }];
};

const lion = (): [RigBuilder, number, AnimSpec] => {
  const ROBE = 0x5a1a2a;
  const SKIN = 0x8a6a7a;
  const GOLD = 0xc8a050;
  const d: BipedDims = {
    hip: 58, hipW: 7, knee: 30, ankle: 5, chest: 78, shoulder: 100, shoulderW: 16, neck: 104, headX: 4,
    elbow: 80, elbowX: 4, hand: 60, handX: 8, thigh: [5, 4], shin: [4, 3.5], upper: [5, 4], fore: [4.5, 3.5], handR: 4,
    foot: [13, 4, 6], legColor: 0x2a1a20, footColor: 0x1a1214, armColor: ROBE, foreColor: SKIN, handColor: SKIN,
  };
  const r = biped(d);
  add(r, 'hips', lathe([[20, 0], [16, 14], [12, 26], [0, 28]], 8), { p: [0, 34, 0] }, ROBE, { jitter: 1 });
  add(r, 'hips', torus(19, 1.6, 3, 8), { p: [0, 35, 0] }, GOLD);
  add(r, 'chest', cylB(13, 11, 34, 7), { p: [0, 66, 0] }, ROBE, { grad: 0.3 });
  add(r, 'chest', cylB(14, 14, 4, 7), { p: [0, 74, 0] }, GOLD);
  for (const [, z] of SIDES) add(r, 'chest', ico(8, 0), { p: [0, 100, z * 16] }, 0x3a1018);
  add(r, 'head', sphere(9.5, 7, 6), { p: [7, 112, 0] }, SKIN);
  for (const [, z] of SIDES) add(r, 'head', horn([-22, 16, z * 10], [-2, 18, z * 6], 3.6, 0.4, 5, 5), { p: [4, 118, z * 5] }, 0x2a2020);
  eyes(r, 'head', 15, 113, 3.5, 2.2, 0xff4a2a);
  const hr = handPos(d, 1);
  limb(r, 'foreR', [hr[0], hr[1] - 50, hr[2]], [hr[0] + 2, hr[1] + 50, hr[2]], 2, 1.6, 0x3a2420);
  add(r, 'foreR', crescent(8, 3, 2, Math.PI * 1.3), { p: [hr[0] + 2, hr[1] + 54, hr[2]], r: [0, Math.PI / 2, Math.PI / 2] }, GOLD);
  add(r, 'foreR', ico(4.5, 0), { p: [hr[0] + 2, hr[1] + 56, hr[2]] }, 0x8aff4a, { emissive: 1.5 });
  const hl = handPos(d, -1);
  add(r, 'foreL', ico(5, 0), { p: hl }, 0xff5a2a, { emissive: 1.4 });
  return [r, 136, { type: 'biped', attack: 'cast', walkHz: 1, stride: 0.42, attackDur: 1.2 }];
};

const viper = (): [RigBuilder, number, AnimSpec] => {
  const r = new RigBuilder();
  const SC = 0x3a8a3a;
  const DARK = 0x1e4a26;
  r.bone('root', null, [0, 0, 0]).bone('body', 'root', [0, 40, 0]);
  r.bone('neck', 'body', [24, 46, 0]).bone('head', 'neck', [46, 64, 0]).bone('tail', 'body', [-26, 40, 0]);
  r.bone('wingL', 'body', [4, 50, -10]).bone('wingR', 'body', [4, 50, 10]);
  add(r, 'body', ico(20, 1), { p: [0, 40, 0], s: [1.6, 0.8, 0.8] }, SC, { jitter: 1.2, grad: 0.4 });
  add(r, 'body', ico(14, 0), { p: [4, 33, 0], s: [1.8, 0.5, 0.8] }, 0xa8c860);
  for (let i = 0; i < 5; i++) add(r, 'body', horn([-3, 9, 0], [-1, 5, 0], 2.6, 0.3, 2, 4), { p: [-16 + i * 8, 54 - Math.abs(i - 2), 0] }, DARK);
  for (const [, z] of SIDES) {
    limb(r, 'body', [-10, 34, z * 8], [-6, 18, z * 10], 4, 3, SC);
    for (let i = -1; i <= 1; i++) add(r, 'body', horn([5, -3, i * 2], [3, 0, i], 1.2, 0.2, 2, 3), { p: [-6, 18, z * 10] }, 0xd8ccac);
  }
  limb(r, 'neck', [22, 44, 0], [46, 64, 0], 7.5, 5.5, SC);
  add(r, 'head', ico(9, 1), { p: [52, 66, 0], s: [1.7, 0.8, 0.8] }, SC);
  add(r, 'head', boxB(14, 3, 9), { p: [58, 59, 0] }, DARK);
  for (const [, z] of SIDES) add(r, 'head', horn([-12, 8, z * 4], [-5, 5, z * 2], 2.2, 0.3, 3, 4), { p: [46, 70, z * 4] }, DARK);
  eyes(r, 'head', 60, 68, 4.5, 2.2, 0xe8ff3a);
  add(r, 'tail', horn([-46, -10, 0], [-24, 6, 0], 7, 1.5, 5, 5), { p: [-26, 40, 0] }, SC);
  add(r, 'tail', octa(5), { p: [-73, 30, 0], s: [1.6, 0.6, 0.6] }, 0xd8ff6a, { emissive: 0.6 });
  wing(r, 'L', [4, 50, -10], 60, 0x2e5a26, DARK);
  wing(r, 'R', [4, 50, 10], 60, 0x2e5a26, DARK);
  // Design top ≈ 76 (raised wing tips); hover adds the rest of the 140 height.
  return [r, 76 / 0.72, { type: 'flyer', attack: 'spit', walkHz: 1, stride: 0, attackDur: 1.1, hover: 0.28 }];
};

const shadowFiend = (): [RigBuilder, number, AnimSpec] => {
  const DARK = 0x2a2228;
  const FIRE = 0xff6a2a;
  const d: BipedDims = {
    hip: 54, hipW: 10, knee: 30, ankle: 6, chest: 72, shoulder: 112, shoulderW: 26, shoulderX: 4, neck: 116, headX: 12,
    elbow: 86, elbowX: 10, hand: 62, handX: 18, thigh: [6, 5], shin: [5, 4], upper: [6, 5], fore: [5, 4], handR: 6,
    foot: [14, 5, 8], legColor: DARK, footColor: DARK, armColor: DARK, handColor: FIRE, noLegs: true,
  };
  const r = biped(d);
  r.bone('wingL', 'chest', [-8, 112, -14]).bone('wingR', 'chest', [-8, 112, 14]);
  add(r, 'robe', lathe([[4, 4], [12, 18], [20, 40], [16, 56], [0, 58]], 7), undefined, 0x1a1418, { jitter: 2, grad: 0.6 });
  add(r, 'robe', ico(6, 0), { p: [0, 8, 0] }, FIRE, { emissive: 1 });
  add(r, 'chest', ico(23, 1), { p: [4, 92, 0], s: [0.9, 1.25, 1] }, DARK, { jitter: 1.5, grad: 0.35 });
  for (let i = 0; i < 3; i++) add(r, 'chest', torus(18 - i * 2, 1.3, 3, 8, Math.PI), { p: [6, 84 + i * 8, 0], r: [0, Math.PI / 2, 0] }, 0x6a5a5a);
  for (const [, z] of SIDES) add(r, 'chest', horn([0, 20, z * 6], [0, 10, z * 2], 4, 0.4, 3, 4), { p: [2, 116, z * 22] }, 0x3a2a2a);
  add(r, 'head', ico(13, 1), { p: [18, 124, 0], s: [1.1, 1, 0.9] }, DARK);
  for (const [, z] of SIDES) add(r, 'head', horn([-24, 18, z * 12], [-4, 16, z * 6], 4, 0.4, 5, 5), { p: [14, 132, z * 6] }, 0x1a1214);
  eyes(r, 'head', 29, 127, 5, 3, FIRE);
  add(r, 'head', box(3, 2, 10), { p: [30, 118, 0] }, FIRE, { emissive: 1.4 });
  for (const [S, z] of SIDES) {
    const h = handPos(d, z);
    r.add(ico(8, 0), { p: h }, `fore${S}`, { color: FIRE, emissive: 1.5 });
    for (let i = -1; i <= 1; i++) r.add(horn([10, -6, i * 4], [6, -1, i * 2], 1.6, 0.2, 2, 3), { p: h }, `fore${S}`, { color: 0x1a1214 });
  }
  wing(r, 'L', [-8, 112, -14], 80, 0x3a1418, 0x1a1214);
  wing(r, 'R', [-8, 112, 14], 80, 0x3a1418, 0x1a1214);
  return [r, 150, { type: 'hover', attack: 'claw', walkHz: 1, stride: 0, attackDur: 1.0, hover: 0.06 }];
};

const lich = (): [RigBuilder, number, AnimSpec] => {
  const ROBE = 0x26345e;
  const BONE = 0xd0e4f0;
  const ICE = 0x8ad0ff;
  const d: BipedDims = {
    hip: 44, hipW: 8, knee: 24, ankle: 5, chest: 62, shoulder: 100, shoulderW: 18, neck: 104, headX: 6,
    elbow: 78, elbowX: 6, hand: 58, handX: 12, thigh: [5, 4], shin: [4, 3], upper: [3, 2.5], fore: [2.6, 2.2], handR: 3.5,
    foot: [10, 4, 6], legColor: ROBE, footColor: ROBE, armColor: BONE, handColor: BONE, noLegs: true,
  };
  const r = biped(d);
  add(r, 'robe', lathe([[24, 0], [20, 22], [15, 40], [0, 46]], 8), undefined, ROBE, { jitter: 1.5, grad: 0.4 });
  add(r, 'robe', torus(23, 2.2, 3, 8), { p: [0, 2, 0] }, ICE, { emissive: 0.4 });
  add(r, 'chest', cylB(6, 9, 30, 6), { p: [0, 52, 0] }, ROBE);
  for (let i = 0; i < 4; i++) add(r, 'chest', torus(13 - i, 1.4, 3, 8, Math.PI * 1.4), { p: [2, 74 + i * 6, 0], r: [0, Math.PI / 2 + 0.6, 0] }, BONE);
  limb(r, 'chest', [-4, 60, 0], [-2, 100, 0], 2.5, 2.2, BONE);
  for (const [, z] of SIDES) {
    add(r, 'chest', ico(9, 0), { p: [0, 100, z * 18], s: [1, 0.6, 1] }, ROBE);
    for (let i = 0; i < 2; i++) add(r, 'chest', horn([-2, 14, z * 4], [0, 7, z * 2], 2.4, 0.3, 2, 4), { p: [-2 + i * 4, 104, z * (16 + i * 3)] }, ICE, { emissive: 0.35 });
  }
  add(r, 'head', sphere(10.5, 7, 6), { p: [10, 112, 0] }, BONE);
  add(r, 'head', boxB(10, 6, 12), { p: [14, 100, 0] }, 0xb0c4d0);
  eyes(r, 'head', 19, 114, 4, 2.6, ICE);
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    add(r, 'head', horn([Math.cos(a) * 4, 18 - Math.abs(i - 2) * 3, Math.sin(a) * 8], [0, 8, 0], 2.6, 0.3, 2, 4), { p: [6 + Math.cos(a) * 6, 120, Math.sin(a) * 9] }, ICE, { emissive: 0.5 });
  }
  const hl = handPos(d, -1);
  add(r, 'foreL', ico(7, 1), { p: [hl[0] + 3, hl[1] + 4, hl[2]] }, ICE, { emissive: 1.4, flat: false });
  return [r, 142, { type: 'hover', attack: 'cast', walkHz: 1, stride: 0, attackDur: 1.3, hover: 0.06 }];
};

const BUILDERS: Record<UnitModelId, () => [RigBuilder, number, AnimSpec]> = {
  treant,
  archer,
  glaive_thrower: glaiveThrower,
  ghoul,
  necrolyte,
  meat_wagon: meatWagon,
  kobold,
  centaur,
  wolf,
  ogre,
  satyr,
  troll,
  golem,
  dragon,
  roshan,
  pudge,
  lion,
  viper,
  shadow_fiend: shadowFiend,
  lich,
};

const templates = new Map<string, RigTemplate>();
const warned = new Set<string>();

export interface UnitModelOptions {
  /** Override the model height (e.g. to match the sim hitbox exactly). */
  height?: number;
}

/**
 * Creates an animated low-poly unit model. `id` may be a model id (see UNIT_MODEL_IDS) or any
 * unit/hero id containing a known name (e.g. 'sentinel_creep_melee', 'hero_pudge').
 * Unknown ids fall back to the kobold model (console.warn once).
 */
export const createUnitModel = (id: string, opts: UnitModelOptions = {}): AnimatedModel => {
  let mid = resolveUnitModelId(id);
  if (!mid) {
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(`[world] no unit model for "${id}", using kobold`);
    }
    mid = 'kobold';
  }
  const height = opts.height ?? UNIT_MODEL_HEIGHTS[mid];
  const key = `${mid}:${height}`;
  let tpl = templates.get(key);
  if (!tpl) {
    const [rig, designHeight, anim] = BUILDERS[mid]();
    tpl = bakeRig(mid, rig, designHeight, height, anim);
    templates.set(key, tpl);
  }
  return instantiateRig(tpl, getPaintedMaterial());
};

export const disposeUnitCache = (): void => {
  for (const t of templates.values()) t.geometry.dispose();
  templates.clear();
};
