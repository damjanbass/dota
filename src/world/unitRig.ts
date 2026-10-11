// Procedural rig: rigid-skinned SkinnedMesh (ONE draw call per unit) + code-driven animations
// (idle / walk / attack / death) for a few archetypes. Models face +X, up +Y, left = −Z.
import { Bone, Group, Skeleton, SkinnedMesh, Sphere } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { ModelBuilder } from './geom';
import type { PartOptions, V3, Xform } from './geom';

export type AnimName = 'idle' | 'walk' | 'attack' | 'death';

export interface PlayOptions {
  /** Restart the clip even if it is already playing. */
  restart?: boolean;
  /** Playback speed multiplier (e.g. attack speed). */
  speed?: number;
}

export interface AnimatedModel {
  object3D: Object3D;
  readonly id: string;
  /** Model height in WC3 units (feet → top of head). */
  readonly height: number;
  readonly current: AnimName;
  play(name: AnimName, opts?: PlayOptions): void;
  update(dt: number): void;
  dispose(): void;
}

export type RigType = 'biped' | 'hover' | 'quad' | 'cart' | 'flyer';
export type AttackStyle = 'swing' | 'claw' | 'bow' | 'cast' | 'smash' | 'hook' | 'bite' | 'launch' | 'recoil' | 'spit';

export interface AnimSpec {
  type: RigType;
  attack: AttackStyle;
  /** Walk cycles per second. */
  walkHz: number;
  /** Leg swing amplitude (radians). */
  stride: number;
  /** Seconds per attack cycle at speed 1. */
  attackDur: number;
  /** Hover height as a fraction of model height (hover / flyer). */
  hover?: number;
}

interface BoneDef {
  name: string;
  parent: number;
  pivot: V3;
}

/** Collects bones + rigidly bound parts in model space. */
export class RigBuilder {
  readonly b = new ModelBuilder();
  readonly bones: BoneDef[] = [];
  private index = new Map<string, number>();

  bone(name: string, parent: string | null, pivot: V3): this {
    const p = parent === null ? -1 : this.index.get(parent);
    if (p === undefined) throw new Error(`unknown parent bone ${parent}`);
    this.index.set(name, this.bones.length);
    this.bones.push({ name, parent: p, pivot });
    return this;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  add(geo: BufferGeometry, t: Xform | undefined, bone: string, o: Omit<PartOptions, 'bone'>): this {
    const bi = this.index.get(bone);
    if (bi === undefined) throw new Error(`unknown bone ${bone}`);
    this.b.add(geo, t, { ...o, bone: bi });
    return this;
  }
}

export interface RigTemplate {
  id: string;
  geometry: BufferGeometry;
  bones: BoneDef[];
  height: number;
  anim: AnimSpec;
}

/** Scales a rig so `designHeight` maps to `height` and bakes the geometry. */
export const bakeRig = (id: string, r: RigBuilder, designHeight: number, height: number, anim: AnimSpec): RigTemplate => {
  const k = height / designHeight;
  r.b.scale(k);
  const bones = r.bones.map((bd) => ({ ...bd, pivot: [bd.pivot[0] * k, bd.pivot[1] * k, bd.pivot[2] * k] as V3 }));
  return { id, geometry: r.b.build(), bones, height, anim };
};

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => v * v * (3 - 2 * v);

/** Piecewise smooth keyframes: [[u, value], ...] with u ascending in [0, 1]. Pure. */
export const kf = (u: number, keys: ReadonlyArray<readonly [number, number]>): number => {
  if (u <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, v1] = keys[i]!;
    const [u0, v0] = keys[i - 1]!;
    if (u <= u1) return v0 + (v1 - v0) * smooth(clamp01((u - u0) / (u1 - u0)));
  }
  return keys[keys.length - 1]![1];
};

type Bones = Record<string, Bone | undefined>;

const rot = (b: Bone | undefined, x: number, y: number, z: number): void => {
  if (b) b.rotation.set(b.rotation.x + x, b.rotation.y + y, b.rotation.z + z);
};

const TAU = Math.PI * 2;

const applyAttack = (B: Bones, style: AttackStyle, u: number, H: number): void => {
  const root = B.root!;
  switch (style) {
    case 'swing':
      rot(B.armR, kf(u, [[0, 0], [0.12, 0.6], [0.4, 0.5], [0.55, -0.2], [1, 0]]), 0, kf(u, [[0, 0], [0.4, 2.6], [0.55, -0.5], [1, 0]]));
      rot(B.foreR, 0, 0, kf(u, [[0, 0], [0.4, 0.7], [0.55, 0], [1, 0]]));
      rot(B.chest, 0, kf(u, [[0, 0], [0.4, 0.35], [0.55, -0.35], [1, 0]]), kf(u, [[0, 0], [0.4, 0.12], [0.55, -0.3], [1, 0]]));
      rot(B.armL, 0, 0, kf(u, [[0, 0], [0.4, -0.4], [0.55, 0.3], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.4, -0.02], [0.55, 0.07], [1, 0]]) * H;
      break;
    case 'claw':
      rot(B.armL, 0, 0, kf(u, [[0, 0], [0.22, 2.1], [0.36, -0.5], [0.55, 0], [1, 0]]));
      rot(B.armR, 0, 0, kf(u, [[0, 0], [0.4, 0], [0.6, 2.1], [0.74, -0.5], [1, 0]]));
      rot(B.chest, 0, kf(u, [[0, 0], [0.36, -0.25], [0.74, 0.25], [1, 0]]), kf(u, [[0, 0], [0.36, -0.3], [0.5, -0.1], [0.74, -0.3], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.36, 0.05], [0.5, 0.02], [0.74, 0.06], [1, 0]]) * H;
      break;
    case 'smash':
      for (const a of [B.armL, B.armR]) rot(a, 0, 0, kf(u, [[0, 0], [0.45, 2.9], [0.6, -0.2], [1, 0]]));
      rot(B.chest, 0, 0, kf(u, [[0, 0], [0.45, 0.3], [0.6, -0.55], [0.8, -0.4], [1, 0]]));
      rot(B.head, 0, 0, kf(u, [[0, 0], [0.45, 0.2], [0.6, -0.2], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.6, 0.05], [1, 0]]) * H;
      break;
    case 'bow':
      rot(B.armL, kf(u, [[0, 0], [0.2, -0.25], [0.85, -0.25], [1, 0]]), 0, kf(u, [[0, 0], [0.2, 1.55], [0.85, 1.55], [1, 0]]));
      rot(B.armR, kf(u, [[0, 0], [0.2, 0.3], [0.85, 0.3], [1, 0]]), 0, kf(u, [[0, 0], [0.2, 1.45], [0.6, 1.35], [0.65, 1.6], [1, 0]]));
      rot(B.foreR, 0, 0, kf(u, [[0, 0], [0.2, 1.4], [0.6, 2.2], [0.65, 0.4], [1, 0]]));
      rot(B.chest, 0, kf(u, [[0, 0], [0.2, -0.3], [0.85, -0.3], [1, 0]]), 0);
      break;
    case 'cast':
      for (const a of [B.armL, B.armR]) rot(a, 0, 0, kf(u, [[0, 0], [0.35, 1.0], [0.5, 1.75], [0.7, 1.7], [1, 0]]));
      for (const a of [B.foreL, B.foreR]) rot(a, 0, 0, kf(u, [[0, 0], [0.35, 1.2], [0.5, 0.1], [1, 0]]));
      rot(B.chest, 0, 0, kf(u, [[0, 0], [0.35, 0.18], [0.5, -0.22], [1, 0]]));
      rot(B.head, 0, 0, kf(u, [[0, 0], [0.35, 0.12], [0.5, -0.1], [1, 0]]));
      break;
    case 'hook':
      rot(B.armR, kf(u, [[0, 0], [0.35, 0.5], [0.5, -0.2], [1, 0]]), 0, kf(u, [[0, 0], [0.35, 2.8], [0.5, 1.0], [0.7, 0.8], [1, 0]]));
      rot(B.chest, 0, kf(u, [[0, 0], [0.35, 0.6], [0.5, -0.45], [1, 0]]), kf(u, [[0, 0], [0.5, -0.2], [1, 0]]));
      rot(B.armL, 0, 0, kf(u, [[0, 0], [0.35, -0.5], [0.5, 0.5], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.5, 0.05], [1, 0]]) * H;
      break;
    case 'bite':
      rot(B.neck ?? B.head, 0, 0, kf(u, [[0, 0], [0.3, 0.4], [0.45, -0.45], [0.7, -0.2], [1, 0]]));
      rot(B.legFL, 0, 0, kf(u, [[0, 0], [0.3, 0.5], [0.45, -0.2], [1, 0]]));
      rot(B.legFR, 0, 0, kf(u, [[0, 0], [0.3, 0.5], [0.45, -0.2], [1, 0]]));
      rot(B.body, 0, 0, kf(u, [[0, 0], [0.3, 0.15], [0.45, -0.1], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.3, -0.04], [0.45, 0.1], [1, 0]]) * H;
      break;
    case 'launch':
      // Catapult arm rests pointing backward; negative Z swings it up and over the front.
      rot(B.arm, 0, 0, kf(u, [[0, 0], [0.25, 0.25], [0.38, -2.0], [0.6, -1.9], [1, 0]]));
      rot(B.body, kf(u, [[0, 0], [0.38, 0], [0.45, 0.04], [0.6, 0], [1, 0]]), 0, kf(u, [[0, 0], [0.38, -0.06], [0.5, 0.03], [1, 0]]));
      break;
    case 'recoil':
      rot(B.arm, 0, 0, kf(u, [[0, 0], [0.3, 0.16], [0.4, -0.1], [0.55, 0.02], [1, 0]]));
      rot(B.glaive, kf(u, [[0, 0], [0.4, 0], [0.42, 6], [1, 18]]), 0, 0);
      rot(B.body, 0, 0, kf(u, [[0, 0], [0.4, 0], [0.45, 0.04], [1, 0]]));
      break;
    case 'spit':
      rot(B.neck ?? B.head, 0, 0, kf(u, [[0, 0], [0.3, 0.45], [0.45, -0.35], [1, 0]]));
      rot(B.head, 0, 0, kf(u, [[0, 0], [0.3, 0.2], [0.45, -0.25], [1, 0]]));
      rot(B.body, 0, 0, kf(u, [[0, 0], [0.3, 0.15], [0.45, -0.12], [1, 0]]));
      root.position.x += kf(u, [[0, 0], [0.3, -0.05], [0.45, 0.04], [1, 0]]) * H;
      break;
  }
};

const applyLocomotion = (B: Bones, spec: AnimSpec, name: AnimName, t: number, H: number): void => {
  const root = B.root!;
  const walking = name === 'walk';
  const ph = t * spec.walkHz * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const st = walking ? spec.stride : 0;
  const breath = Math.sin(t * 2.1);
  switch (spec.type) {
    case 'biped': {
      rot(B.legL, 0, 0, st * s);
      rot(B.legR, 0, 0, -st * s);
      rot(B.shinL, 0, 0, -st * 0.55 * (1 + c));
      rot(B.shinR, 0, 0, -st * 0.55 * (1 - c));
      rot(B.armL, walking ? 0 : -0.04, 0, -0.75 * st * s + (walking ? 0 : 0.05 * breath));
      rot(B.armR, walking ? 0 : 0.04, 0, 0.75 * st * s + (walking ? 0 : 0.05 * breath));
      rot(B.foreL, 0, 0, walking ? 0.3 + 0.2 * s : 0.12);
      rot(B.foreR, 0, 0, walking ? 0.3 - 0.2 * s : 0.12);
      rot(B.hips, 0, 0.12 * st * s, 0);
      rot(B.chest, 0, -0.14 * st * s, (walking ? -0.07 : 0) + 0.02 * breath);
      rot(B.head, 0, walking ? 0.05 * s : 0.08 * Math.sin(t * 0.7), 0);
      root.position.y += walking ? Math.abs(s) * 0.022 * H : 0;
      rot(B.tail, 0, 0.3 * Math.sin(t * (walking ? spec.walkHz * TAU : 1.5)), 0);
      break;
    }
    case 'hover': {
      const hov = (spec.hover ?? 0.05) * H;
      root.position.y += hov + Math.sin(t * 1.7) * 0.02 * H;
      rot(B.chest, 0, 0, walking ? -0.16 : 0.03 * breath);
      rot(B.robe, 0, 0, walking ? 0.22 + 0.04 * s : 0.03 * Math.sin(t * 1.3));
      rot(B.armL, -0.08, 0, walking ? -0.35 : 0.08 * breath);
      rot(B.armR, 0.08, 0, walking ? -0.35 : 0.08 * breath);
      rot(B.foreL, 0, 0, 0.35);
      rot(B.foreR, 0, 0, 0.35);
      rot(B.head, 0, 0.1 * Math.sin(t * 0.8), 0);
      const flap = Math.sin(t * (walking ? 5 : 2.2));
      rot(B.wingL, 0.25 * flap + 0.1, 0, 0);
      rot(B.wingR, -0.25 * flap - 0.1, 0, 0);
      break;
    }
    case 'quad': {
      rot(B.legFL, 0, 0, st * s);
      rot(B.legBR, 0, 0, st * s);
      rot(B.legFR, 0, 0, -st * s);
      rot(B.legBL, 0, 0, -st * s);
      rot(B.body, 0.02 * breath, 0, walking ? 0.03 * c : 0.015 * breath);
      root.position.y += walking ? Math.abs(c) * 0.025 * H : 0;
      rot(B.neck, 0, 0, walking ? 0.06 * s : 0.04 * breath);
      rot(B.head, 0, walking ? 0 : 0.15 * Math.sin(t * 0.6), 0);
      rot(B.tail, 0, 0.35 * Math.sin(t * (walking ? spec.walkHz * TAU : 2)), 0.1 * breath);
      // Centaur-style upper body.
      rot(B.chest, 0, -0.08 * st * s, 0.02 * breath);
      rot(B.armL, -0.05, 0, -0.4 * st * s + 0.05 * breath);
      rot(B.armR, 0.05, 0, 0.4 * st * s + 0.05 * breath);
      const flap = Math.sin(t * 2.4);
      rot(B.wingL, 0.12 * flap + 0.15, 0, 0);
      rot(B.wingR, -0.12 * flap - 0.15, 0, 0);
      break;
    }
    case 'cart': {
      const roll = walking ? -t * 4.2 : 0;
      for (const w of [B.wheelFL, B.wheelFR, B.wheelBL, B.wheelBR]) rot(w, 0, 0, roll);
      rot(B.body, walking ? 0.025 * s : 0, 0, walking ? 0.015 * c : 0.005 * breath);
      root.position.y += walking ? Math.abs(s) * 0.01 * H : 0;
      rot(B.glaive, t * (walking ? 3 : 1.2), 0, 0);
      break;
    }
    case 'flyer': {
      const hov = (spec.hover ?? 0.3) * H;
      root.position.y += hov + Math.sin(t * 2) * 0.03 * H;
      const flapHz = walking ? 2.2 : 1.3;
      const flap = Math.sin(t * flapHz * TAU);
      rot(B.wingL, 0.55 * flap, 0, 0);
      rot(B.wingR, -0.55 * flap, 0, 0);
      rot(B.body, 0, 0, walking ? -0.12 : 0.04 * flap);
      rot(B.neck, 0, 0.08 * Math.sin(t * 0.9), 0.06 * flap);
      rot(B.tail, 0, 0.3 * Math.sin(t * 1.6), 0.1 * flap);
      break;
    }
  }
};

const applyDeath = (B: Bones, spec: AnimSpec, t: number, H: number): void => {
  const root = B.root!;
  const d = smooth(clamp01(t / 0.9));
  const sink = Math.min(0.7, Math.max(0, t - 3) * 0.25) * H;
  switch (spec.type) {
    case 'biped':
    case 'hover': {
      const hov = spec.type === 'hover' ? (spec.hover ?? 0.05) * H * (1 - d) : 0;
      root.position.y += hov - sink;
      rot(root, 0.25 * d, 0, (Math.PI / 2) * d);
      rot(B.armL, -0.6 * d, 0, 1.2 * d);
      rot(B.armR, 0.6 * d, 0, 1.0 * d);
      rot(B.legL, 0, 0, 0.3 * d);
      rot(B.head, 0, 0, 0.4 * d);
      break;
    }
    case 'quad':
      root.position.y -= sink;
      rot(root, (Math.PI / 2) * d, 0, 0);
      for (const l of [B.legFL, B.legFR, B.legBL, B.legBR]) rot(l, 0, 0, 0.4 * d);
      rot(B.neck, 0, 0, -0.3 * d);
      break;
    case 'cart':
      root.position.y -= sink + 0.06 * H * d;
      rot(root, 0.45 * d, 0, -0.15 * d);
      rot(B.arm, 0, 0, -0.5 * d);
      break;
    case 'flyer': {
      const hov = (spec.hover ?? 0.3) * H;
      const fall = clamp01(t / 0.7);
      root.position.y += hov * (1 - fall * fall) - sink;
      rot(root, (Math.PI / 2) * d, 0, 0);
      rot(B.wingL, -0.8 * d, 0, 0);
      rot(B.wingR, 0.8 * d, 0, 0);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export const instantiateRig = (tpl: RigTemplate, material: Material): AnimatedModel => {
  const bones: Bone[] = tpl.bones.map((bd) => {
    const b = new Bone();
    b.name = bd.name;
    return b;
  });
  tpl.bones.forEach((bd, i) => {
    const b = bones[i]!;
    if (bd.parent >= 0) {
      const pp = tpl.bones[bd.parent]!.pivot;
      b.position.set(bd.pivot[0] - pp[0], bd.pivot[1] - pp[1], bd.pivot[2] - pp[2]);
      bones[bd.parent]!.add(b);
    } else {
      b.position.set(bd.pivot[0], bd.pivot[1], bd.pivot[2]);
    }
  });
  const rest = bones.map((b) => b.position.clone());
  const mesh = new SkinnedMesh(tpl.geometry, material);
  mesh.name = `unit_${tpl.id}`;
  mesh.add(bones[0]!);
  mesh.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Generous static bounds (animation never leaves this sphere).
  mesh.boundingSphere = new Sphere();
  mesh.boundingSphere.center.set(0, tpl.height * 0.5, 0);
  mesh.boundingSphere.radius = tpl.height * 1.3;

  const object3D = new Group();
  object3D.name = tpl.id;
  object3D.add(mesh);
  object3D.userData = { unitModel: tpl.id, height: tpl.height };

  const B: Bones = {};
  bones.forEach((b) => (B[b.name] = b));
  const H = tpl.height;
  let current: AnimName = 'idle';
  let t = 0;
  let speed = 1;

  const pose = (): void => {
    bones.forEach((b, i) => {
      b.position.copy(rest[i]!);
      b.rotation.set(0, 0, 0);
    });
    const spec = tpl.anim;
    if (current === 'death') {
      applyDeath(B, spec, t, H);
      return;
    }
    if (current === 'attack') {
      // Attack loops (one swing per cycle) until another clip is played; restart syncs a swing.
      const u = (t % spec.attackDur) / spec.attackDur;
      applyLocomotion(B, spec, 'idle', t, H);
      applyAttack(B, spec.attack, u, H);
      return;
    }
    applyLocomotion(B, spec, current, t, H);
  };
  pose();

  return {
    object3D,
    id: tpl.id,
    height: tpl.height,
    get current() {
      return current;
    },
    play: (name, opts) => {
      speed = opts?.speed ?? 1;
      if (name === current && !opts?.restart) return;
      current = name;
      t = 0;
      pose();
    },
    update: (dt) => {
      t += dt * speed;
      pose();
    },
    dispose: () => {
      skeleton.dispose();
    },
  };
};
