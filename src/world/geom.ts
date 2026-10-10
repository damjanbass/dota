// Low-poly model builder: transforms primitive geometries, paints them with vertex colours
// (vertical gradient + per-face jitter = hand-painted look) and merges them into ONE geometry
// with `position`, `normal`, `color`, `aEmissive` (+ `skinIndex`/`skinWeight` when bones are used).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix3,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  BoxGeometry,
} from 'three';
import type { ColorRepresentation } from 'three';
import { hash3f } from './noise';

export type V3 = readonly [number, number, number];

export interface Xform {
  /** Translation. */
  p?: V3;
  /** Euler rotation (radians, XYZ order). */
  r?: V3;
  /** Uniform or per-axis scale. */
  s?: number | V3;
}

export interface PartOptions {
  color: ColorRepresentation;
  /** 0..1+, multiplies the vertex colour into emissive (glow). */
  emissive?: number;
  /** Faceted normals (default true — chunky low-poly look). */
  flat?: boolean;
  /** Random vertex displacement in local units (applied before transform, position-hashed). */
  jitter?: number;
  /** Per-face brightness variation 0..1 (default 0.12). */
  shade?: number;
  /** Bottom-to-top darkening strength 0..1 (default 0.25). */
  grad?: number;
  /** Bone index for rigid skinning. */
  bone?: number;
  /** Seed for jitter / shading. */
  seed?: number;
}

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();
const _c = new Color();

export const xform = (t: Xform | Matrix4 | undefined): Matrix4 => {
  if (!t) return new Matrix4();
  if (t instanceof Matrix4) return t;
  _e.set(t.r?.[0] ?? 0, t.r?.[1] ?? 0, t.r?.[2] ?? 0);
  _q.setFromEuler(_e);
  const s = t.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _p.set(t.p?.[0] ?? 0, t.p?.[1] ?? 0, t.p?.[2] ?? 0);
  return new Matrix4().compose(_p, _q, _s);
};

export class ModelBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private emi: number[] = [];
  private bones: number[] = [];
  private usesBones = false;

  /** Adds a primitive. The source geometry is disposed. */
  add(geo: BufferGeometry, t: Xform | Matrix4 | undefined, o: PartOptions): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const posAttr = g.getAttribute('position') as BufferAttribute;
    const seed = o.seed ?? 0;
    if (o.jitter) {
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);
        const j = o.jitter;
        posAttr.setXYZ(
          i,
          x + (hash3f(x, y, z, seed + 1) - 0.5) * 2 * j,
          y + (hash3f(x, y, z, seed + 2) - 0.5) * 2 * j,
          z + (hash3f(x, y, z, seed + 3) - 0.5) * 2 * j,
        );
      }
    }
    const flat = o.flat ?? true;
    if (flat || !g.getAttribute('normal')) g.computeVertexNormals();
    const nAttr = g.getAttribute('normal') as BufferAttribute;
    const m = xform(t);
    _nm.getNormalMatrix(m);

    // Vertical extent (local) for gradient shading.
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const h = Math.max(1e-6, bb.max.y - bb.min.y);
    const base = new Color(o.color);
    const shade = o.shade ?? 0.12;
    const grad = o.grad ?? 0.25;
    const emissive = o.emissive ?? 0;
    const bone = o.bone ?? 0;
    if (o.bone !== undefined) this.usesBones = true;

    for (let i = 0; i < posAttr.count; i++) {
      _v.fromBufferAttribute(posAttr, i);
      const ly = (_v.y - bb.min.y) / h;
      _v.applyMatrix4(m);
      _n.fromBufferAttribute(nAttr, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      // Per-face jitter for flat parts (first vertex of the triangle drives it), per-vertex otherwise.
      const fi = flat ? i - (i % 3) : i;
      const fx = posAttr.getX(fi);
      const fy = posAttr.getY(fi);
      const fz = posAttr.getZ(fi);
      const k = 1 + (hash3f(fx + i * (flat ? 0 : 0.001), fy, fz, seed + 9) - 0.5) * 2 * shade;
      const gk = 1 - grad + grad * (0.35 + 0.65 * ly) * 1.25;
      _c.copy(base).multiplyScalar(k * Math.min(1.15, gk));
      this.col.push(_c.r, _c.g, _c.b);
      this.emi.push(emissive);
      this.bones.push(bone);
    }
    g.dispose();
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Uniformly scales everything built so far (used to normalise unit heights). */
  scale(k: number): this {
    for (let i = 0; i < this.pos.length; i++) this.pos[i]! *= k;
    return this;
  }

  bounds(): { min: Vector3; max: Vector3 } {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < this.pos.length; i += 3) {
      _v.set(this.pos[i]!, this.pos[i + 1]!, this.pos[i + 2]!);
      min.min(_v);
      max.max(_v);
    }
    return { min, max };
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aEmissive', new BufferAttribute(new Float32Array(this.emi), 1));
    if (this.usesBones) {
      const n = this.bones.length;
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        si[i * 4] = this.bones[i]!;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Primitives (all return fresh geometries; base-anchored variants sit on y = 0)
// ---------------------------------------------------------------------------

export const box = (w: number, h: number, d: number): BufferGeometry => new BoxGeometry(w, h, d);

/** Box resting on y = 0. */
export const boxB = (w: number, h: number, d: number): BufferGeometry => new BoxGeometry(w, h, d).translate(0, h / 2, 0);

/** Cylinder / frustum resting on y = 0. */
export const cylB = (rTop: number, rBot: number, h: number, seg = 8, open = false): BufferGeometry =>
  new CylinderGeometry(rTop, rBot, h, seg, 1, open).translate(0, h / 2, 0);

export const coneB = (r: number, h: number, seg = 8): BufferGeometry => new ConeGeometry(r, h, seg).translate(0, h / 2, 0);

export const sphere = (r: number, ws = 8, hs = 6): BufferGeometry => new SphereGeometry(r, ws, hs);

export const ico = (r: number, detail = 0): BufferGeometry => new IcosahedronGeometry(r, detail);

export const dodeca = (r: number): BufferGeometry => new DodecahedronGeometry(r, 0);

export const octa = (r: number): BufferGeometry => new OctahedronGeometry(r, 0);

export const torus = (R: number, r: number, rs = 5, ts = 12, arc = Math.PI * 2): BufferGeometry =>
  new TorusGeometry(R, r, rs, ts, arc).rotateX(Math.PI / 2);

/** Lathe from [radius, y] pairs. */
export const lathe = (pts: Array<[number, number]>, seg = 8): BufferGeometry =>
  new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, y)),
    seg,
  );

/**
 * Tapered curved horn / spike / rib along a quadratic Bezier from (0,0,0) via `ctrl` to `tip`.
 * Radius goes from r0 at the base to r1 at the tip. Ideal for horns, roots, ribs, claws, tusks.
 */
export const horn = (tip: V3, ctrl: V3, r0: number, r1 = 0, segs = 5, sides = 5): BufferGeometry => {
  const rings: Vector3[][] = [];
  // Quadratic Bezier with P0 = origin.
  const pt = (t: number): Vector3 => {
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return new Vector3(b * ctrl[0] + c * tip[0], b * ctrl[1] + c * tip[1], b * ctrl[2] + c * tip[2]);
  };
  const up = new Vector3(0, 1, 0);
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = pt(t);
    const tan = pt(Math.min(1, t + 0.01)).sub(pt(Math.max(0, t - 0.01))).normalize();
    const side = Math.abs(tan.dot(up)) > 0.95 ? new Vector3(1, 0, 0) : up;
    const nx = new Vector3().crossVectors(tan, side).normalize();
    const ny = new Vector3().crossVectors(nx, tan).normalize();
    const r = r0 + (r1 - r0) * t;
    const ring: Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      ring.push(p.clone().addScaledVector(nx, Math.cos(a) * r).addScaledVector(ny, Math.sin(a) * r));
    }
    rings.push(ring);
  }
  const verts: number[] = [];
  const tri = (a: Vector3, b: Vector3, c: Vector3): void => {
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let s = 0; s < segs; s++) {
    const r0r = rings[s]!;
    const r1r = rings[s + 1]!;
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      tri(r0r[k]!, r1r[k]!, r1r[k2]!);
      tri(r0r[k]!, r1r[k2]!, r0r[k2]!);
    }
  }
  // Cap the base so it doesn't look hollow from below.
  const base = rings[0]!;
  const c0 = pt(0);
  for (let k = 0; k < sides; k++) tri(c0, base[k]!, base[(k + 1) % sides]!);
  if (r1 > 0) {
    const top = rings[segs]!;
    const c1 = pt(1);
    for (let k = 0; k < sides; k++) tri(c1, top[(k + 1) % sides]!, top[k]!);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  return g;
};

/** Flat crescent blade (night-elf glaive / moon motif) in the XY plane, thickness along Z. */
export const crescent = (R: number, width: number, thick: number, arc = Math.PI * 1.2, segs = 10): BufferGeometry => {
  const verts: number[] = [];
  const pts: Array<[Vector3, Vector3]> = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const a = -arc / 2 + arc * t;
    const w = width * Math.sin(Math.PI * t) + 0.5;
    const outer = new Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
    const inner = new Vector3(Math.cos(a) * (R - w), Math.sin(a) * (R - w), 0);
    pts.push([outer, inner]);
  }
  const h = thick / 2;
  const push = (v: Vector3, z: number): void => {
    verts.push(v.x, v.y, z);
  };
  for (let s = 0; s < segs; s++) {
    const [o0, i0] = pts[s]!;
    const [o1, i1] = pts[s + 1]!;
    // front / back faces
    push(o0, h); push(o1, h); push(i1, h);
    push(o0, h); push(i1, h); push(i0, h);
    push(o0, -h); push(i1, -h); push(o1, -h);
    push(o0, -h); push(i0, -h); push(i1, -h);
    // outer / inner rims
    push(o0, -h); push(o1, -h); push(o1, h);
    push(o0, -h); push(o1, h); push(o0, h);
    push(i0, -h); push(i1, h); push(i1, -h);
    push(i0, -h); push(i0, h); push(i1, h);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  return g;
};

/** Points evenly spaced on a circle in the XZ plane. */
export const ring = (n: number, r: number, y = 0, phase = 0): V3[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
  });

/** Yaw angle that points local +X toward (x, z). */
export const yawTo = (x: number, z: number): number => -Math.atan2(z, x);
