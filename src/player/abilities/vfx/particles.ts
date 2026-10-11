// Pooled CPU particles drawn as one THREE.Points with per-particle size / alpha / rotation / colour (one draw call).
// Positions are in three.js space. Render-only.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  NormalBlending,
  Points,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
} from 'three';
import type { Blending, PerspectiveCamera, Texture } from 'three';

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute float rot;
attribute vec3 tint;
uniform float scale;
varying float vAlpha;
varying float vRot;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = alpha > 0.0 ? size * scale / max(1.0, -mv.z) : 0.0;
  vAlpha = alpha;
  vRot = rot;
  vTint = tint;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
varying float vRot;
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot);
  float k = cos(vRot);
  vec4 t = texture2D(map, vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint * t.rgb, a);
  #include <colorspace_fragment>
}`;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  /** World-unit diameter at birth / death. */
  size0: number;
  size1: number;
  alpha: number;
  color: Color | number;
  rot?: number;
  spin?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  /** three.js Y acceleration (negative = falls). */
  gravity?: number;
  /** Fraction of life spent fading in (default 0.15). */
  fadeIn?: number;
}

export class Particles {
  readonly points: Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly sizeAttr: Float32Array;
  private readonly alphaAttr: Float32Array;
  private readonly rotAttr: Float32Array;
  private readonly tintAttr: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly a0: Float32Array;
  private readonly spin: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly fadeIn: Float32Array;
  private cursor = 0;
  private live = 0;
  private readonly material: ShaderMaterial;
  private readonly geometry: BufferGeometry;
  private readonly c = new Color();
  private readonly buf = new Vector2();

  constructor(capacity: number, texture: Texture, opts: { additive?: boolean; renderOrder?: number } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.sizeAttr = new Float32Array(capacity);
    this.alphaAttr = new Float32Array(capacity);
    this.rotAttr = new Float32Array(capacity);
    this.tintAttr = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.fadeIn = new Float32Array(capacity);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('size', new BufferAttribute(this.sizeAttr, 1));
    this.geometry.setAttribute('alpha', new BufferAttribute(this.alphaAttr, 1));
    this.geometry.setAttribute('rot', new BufferAttribute(this.rotAttr, 1));
    this.geometry.setAttribute('tint', new BufferAttribute(this.tintAttr, 3));
    const blending: Blending = opts.additive ? AdditiveBlending : NormalBlending;
    this.material = new ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 400 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? 2;
    // Perspective point size needs the drawing-buffer height and the camera FOV (scope zoom changes it).
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const h = renderer.getDrawingBufferSize(this.buf).y;
      const fov = (camera as PerspectiveCamera).fov ?? 60;
      this.material.uniforms.scale!.value = h / (2 * Math.tan((fov * Math.PI) / 360));
    };
  }

  get count(): number {
    return this.live;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const j = i * 3;
    this.pos[j] = p.x;
    this.pos[j + 1] = p.y;
    this.pos[j + 2] = p.z;
    this.vel[j] = p.vx ?? 0;
    this.vel[j + 1] = p.vy ?? 0;
    this.vel[j + 2] = p.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = Math.max(0.01, p.life);
    this.s0[i] = p.size0;
    this.s1[i] = p.size1;
    this.a0[i] = p.alpha;
    this.rotAttr[i] = p.rot ?? Math.random() * Math.PI * 2;
    this.spin[i] = p.spin ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.fadeIn[i] = p.fadeIn ?? 0.15;
    const c = typeof p.color === 'number' ? this.c.setHex(p.color) : p.color;
    this.tintAttr[j] = c.r;
    this.tintAttr[j + 1] = c.g;
    this.tintAttr[j + 2] = c.b;
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i]! >= this.life[i]!) {
        this.alphaAttr[i] = 0;
        continue;
      }
      live++;
      const age = (this.age[i] = this.age[i]! + dt);
      const k = Math.min(1, age / this.life[i]!);
      const j = i * 3;
      const damp = this.drag[i]! > 0 ? Math.max(0, 1 - this.drag[i]! * dt) : 1;
      this.vel[j] = this.vel[j]! * damp;
      this.vel[j + 1] = this.vel[j + 1]! * damp + this.grav[i]! * dt;
      this.vel[j + 2] = this.vel[j + 2]! * damp;
      this.pos[j] = this.pos[j]! + this.vel[j]! * dt;
      this.pos[j + 1] = this.pos[j + 1]! + this.vel[j + 1]! * dt;
      this.pos[j + 2] = this.pos[j + 2]! + this.vel[j + 2]! * dt;
      this.sizeAttr[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * Math.sqrt(k);
      const fi = this.fadeIn[i]!;
      const fade = k < fi ? k / fi : k > 0.6 ? (1 - k) / 0.4 : 1;
      this.alphaAttr[i] = k >= 1 ? 0 : this.a0[i]! * fade;
      this.rotAttr[i] = this.rotAttr[i]! + this.spin[i]! * dt;
    }
    this.live = live;
    const g = this.geometry;
    for (const name of ['position', 'size', 'alpha', 'rot', 'tint']) (g.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.age.set(this.life);
    this.alphaAttr.fill(0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Radial soft blob (white; tinted per particle). `noise` > 0 roughens it into a dust/smoke puff. */
export const softTexture = (size = 64, noise = 0, seed = 1): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (noise > 0) {
    // Deterministic blotches so the puff isn't a perfect disc.
    let s = seed * 9301 + 49297;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14 * noise; i++) {
      const a = rnd() * Math.PI * 2;
      const r = c * (0.35 + rnd() * 0.6);
      const rr = c * (0.12 + rnd() * 0.22);
      const gg = ctx.createRadialGradient(c + Math.cos(a) * r, c + Math.sin(a) * r, 0, c + Math.cos(a) * r, c + Math.sin(a) * r, rr);
      gg.addColorStop(0, 'rgba(0,0,0,0.55)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, size, size);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
};

/** Vertical fade (opaque at the bottom, transparent at the top) for beams. */
export const beamTexture = (): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
};
