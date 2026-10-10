// World-space shot effects: bullet tracer streaks, impact puffs, bullet-hole decals and the muzzle light.
// Render-only (reads shot results, never writes sim state). Positions come in WC3 coords and are converted here.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Scene } from 'three';
import { vecToThree } from '../core/coords';
import type { Vec3 } from '../core/types';

export type ImpactKind = 'body' | 'head' | 'terrain' | 'tree' | 'building';

const IMPACT_STYLE: Record<ImpactKind, { color: number; size: number; grow: number; count: number; decal: boolean }> = {
  body: { color: 0x9a1010, size: 6, grow: 22, count: 3, decal: false },
  head: { color: 0xc01818, size: 9, grow: 34, count: 5, decal: false },
  terrain: { color: 0xb09670, size: 8, grow: 46, count: 4, decal: true },
  tree: { color: 0x8a6a3a, size: 6, grow: 30, count: 4, decal: true },
  building: { color: 0xa0a0a0, size: 7, grow: 34, count: 4, decal: true },
};

const TRACER_SPEED = 14000;
const TRACER_STREAK = 260;
const PUFF_LIFE = 0.5;
const DECALS = 64;
const PUFFS = 24;

interface Tracer {
  mesh: Mesh;
  line: Line;
  from: Vector3;
  dir: Vector3;
  dist: number;
  traveled: number;
  active: boolean;
}

interface Puff {
  sprite: Sprite;
  vel: Vector3;
  age: number;
  size: number;
  grow: number;
}

export class ShotEffects {
  readonly group = new Group();
  private readonly tracers: Tracer[] = [];
  private readonly puffs: Puff[] = [];
  private readonly decals: InstancedMesh;
  private readonly light: PointLight | null;
  private lightTime = Infinity;
  private decalCursor = 0;
  private puffCursor = 0;
  private tracerCursor = 0;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly s = new Vector3();
  private readonly back = new Vector3(0, 0, 1);

  constructor(
    private readonly scene: Scene,
    opts: { muzzleLight?: boolean } = {},
  ) {
    scene.add(this.group);

    const tracerGeo = new BoxGeometry(1.1, 1.1, 1);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, fog: false });
    const lineMat = new LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.disposables.push(tracerGeo, tracerMat, lineMat);
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh(tracerGeo, tracerMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      const lineGeo = new BufferGeometry();
      lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
      this.disposables.push(lineGeo);
      const line = new Line(lineGeo, lineMat);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(mesh, line);
      this.tracers.push({ mesh, line, from: new Vector3(), dir: new Vector3(), dist: 0, traveled: 0, active: false });
    }

    const puffTex = makeSoftTexture(64, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.5, 'rgba(255,255,255,0.45)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.disposables.push(puffTex);
    for (let i = 0; i < PUFFS; i++) {
      const mat = new SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false });
      this.disposables.push(mat);
      const sprite = new Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, vel: new Vector3(), age: PUFF_LIFE, size: 1, grow: 1 });
    }

    const decalTex = makeSoftTexture(64, [
      [0, 'rgba(10,8,6,1)'],
      [0.35, 'rgba(20,16,12,0.95)'],
      [0.55, 'rgba(40,32,24,0.5)'],
      [1, 'rgba(40,32,24,0)'],
    ]);
    const decalGeo = new PlaneGeometry(1, 1);
    const decalMat = new MeshBasicMaterial({
      map: decalTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.disposables.push(decalTex, decalGeo, decalMat);
    this.decals = new InstancedMesh(decalGeo, decalMat, DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);

    if (opts.muzzleLight ?? true) {
      this.light = new PointLight(0xffc27a, 0, 700, 1);
      this.group.add(this.light);
    } else {
      this.light = null;
    }
  }

  /** Muzzle flash light at a WC3 point. */
  muzzleFlash(at: Vec3): void {
    if (!this.light) return;
    vecToThree(at, this.light.position);
    this.lightTime = 0;
  }

  /** Tracer from a THREE-space start (muzzle as seen on screen) to a WC3 impact point. */
  tracer(fromThree: Vector3, to: Vec3): void {
    const t = this.tracers[this.tracerCursor++ % this.tracers.length]!;
    t.from.copy(fromThree);
    vecToThree(to, t.dir).sub(t.from);
    t.dist = t.dir.length();
    if (t.dist < 1) return;
    t.dir.divideScalar(t.dist);
    t.traveled = 0;
    t.active = true;
    t.mesh.visible = true;
    t.line.visible = true;
    // Orient the streak so local +Z points back towards the shooter.
    t.mesh.quaternion.setFromUnitVectors(this.back, this.v.copy(t.dir).negate());
  }

  /** Impact puff (+ decal on solid surfaces). `normal` is the WC3 surface normal (null = towards the shooter). */
  impact(point: Vec3, normal: Vec3 | null, kind: ImpactKind, shotDir: Vec3): void {
    const style = IMPACT_STYLE[kind];
    const n = normal ? vecToThree(normal, this.v2) : vecToThree(shotDir, this.v2).negate();
    n.normalize();
    const base = vecToThree(point, this.v);
    for (let i = 0; i < style.count; i++) {
      const p = this.puffs[this.puffCursor++ % this.puffs.length]!;
      const spread = 0.6;
      p.vel
        .set(n.x + (Math.random() - 0.5) * spread, n.y + (Math.random() - 0.5) * spread + 0.3, n.z + (Math.random() - 0.5) * spread)
        .multiplyScalar(30 + Math.random() * 40);
      p.sprite.position.copy(base).addScaledVector(n, 2);
      p.age = -i * 0.02;
      p.size = style.size * (0.8 + Math.random() * 0.4);
      p.grow = style.grow * (0.8 + Math.random() * 0.4);
      const mat = p.sprite.material;
      mat.color.setHex(style.color);
      mat.opacity = 0;
      p.sprite.visible = true;
    }
    if (style.decal) {
      this.q.setFromUnitVectors(this.back, n);
      this.s.setScalar(7 + Math.random() * 3);
      this.m4.compose(this.v.copy(base).addScaledVector(n, 0.4), this.q, this.s);
      const i = this.decalCursor++ % DECALS;
      this.decals.setMatrixAt(i, this.m4);
      this.decals.count = Math.min(DECALS, Math.max(this.decals.count, i + 1));
      this.decals.instanceMatrix.needsUpdate = true;
    }
  }

  update(frameDt: number): void {
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.traveled += TRACER_SPEED * frameDt;
      const head = Math.min(t.traveled, t.dist);
      const tail = Math.max(0, t.traveled - TRACER_STREAK);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        t.line.visible = false;
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head);
      t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
      const pos = t.line.geometry.getAttribute('position') as BufferAttribute;
      this.v.copy(t.from).addScaledVector(t.dir, tail);
      pos.setXYZ(0, this.v.x, this.v.y, this.v.z);
      pos.setXYZ(1, t.mesh.position.x, t.mesh.position.y, t.mesh.position.z);
      pos.needsUpdate = true;
    }

    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += frameDt;
      if (p.age >= PUFF_LIFE) {
        p.sprite.visible = false;
        continue;
      }
      if (p.age < 0) continue;
      const k = p.age / PUFF_LIFE;
      p.sprite.position.addScaledVector(p.vel, frameDt);
      p.vel.multiplyScalar(Math.max(0, 1 - frameDt * 4));
      p.sprite.scale.setScalar(p.size + p.grow * Math.sqrt(k));
      p.sprite.material.opacity = 0.85 * (1 - k) * Math.min(1, p.age * 30);
    }

    if (this.light) {
      this.lightTime += frameDt;
      this.light.intensity = this.lightTime < 0.06 ? 500 * (1 - this.lightTime / 0.06) : 0;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.decals.dispose();
  }
}

const makeSoftTexture = (size: number, stops: Array<[number, string]>): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
};
