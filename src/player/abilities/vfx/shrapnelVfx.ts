// Shrapnel visuals: the AoE ground-ring preview under the crosshair, shells raining into active fields, a dust-cloud
// ring for the field's duration and impact puffs / sparks. Render-only: reads the kit logic and sim state.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Scene, Texture } from 'three';
import type { SimApi } from '../../../core/sim';
import { SNIPER_SHRAPNEL, levelValue } from '../../../data';
import { SHRAPNEL, skillLevel } from '../ids';
import type { KitLogic } from '../kitLogic';
import type { ShrapnelField } from '../shrapnel';
import { DrapedAnnulus } from './drape';
import type { HeightFn } from './drape';
import { Particles, softTexture } from './particles';

const SHELLS = 160;
const SHELL_LENGTH = 130;
const DUST_COLORS = [0x8a7a62, 0x9b8b70, 0x6f6352, 0xa89478].map((c) => new Color(c));
const SPARK_COLOR = new Color(0xffb050);

interface FieldVisual {
  id: number;
  edge: DrapedAnnulus;
  material: MeshBasicMaterial;
  shellAcc: number;
  dustAcc: number;
  ticksSeen: number;
  pulse: number;
  placed: boolean;
}

interface Shell {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  groundY: number;
}

export class ShrapnelVfx {
  readonly group = new Group();
  private readonly previewEdge: DrapedAnnulus;
  private readonly previewFill: DrapedAnnulus;
  private readonly previewCenter: DrapedAnnulus;
  private readonly edgeMat: MeshBasicMaterial;
  private readonly fillMat: MeshBasicMaterial;
  private readonly centerMat: MeshBasicMaterial;
  private readonly visuals = new Map<number, FieldVisual>();
  private readonly spare: FieldVisual[] = [];
  private readonly shellMesh: InstancedMesh;
  private readonly shellGeo: BoxGeometry;
  private readonly shellMat: MeshBasicMaterial;
  private readonly shells: Shell[] = [];
  private shellCursor = 0;
  private readonly dust: Particles;
  private readonly sparks: Particles;
  private readonly textures: Texture[] = [];
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private nextVisualId = 1;

  constructor(
    private readonly scene: Scene,
    private readonly heightAt: HeightFn,
  ) {
    const ringMat = (color: number, opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: false,
      });
    this.edgeMat = ringMat(0xffd27a, 0.5);
    this.fillMat = ringMat(0xffb040, 0.06);
    this.centerMat = ringMat(0xffe0a0, 0.6);
    this.previewEdge = new DrapedAnnulus(this.edgeMat, 96, 1);
    this.previewFill = new DrapedAnnulus(this.fillMat, 48, 6);
    this.previewCenter = new DrapedAnnulus(this.centerMat, 24, 1);
    this.group.add(this.previewFill.mesh, this.previewEdge.mesh, this.previewCenter.mesh);
    this.setPreviewVisible(false);

    this.shellGeo = new BoxGeometry(3.5, 1, 3.5);
    this.shellGeo.translate(0, 0.5, 0);
    this.shellMat = new MeshBasicMaterial({ color: 0xffc878, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.shellMesh = new InstancedMesh(this.shellGeo, this.shellMat, SHELLS);
    this.shellMesh.frustumCulled = false;
    for (let i = 0; i < SHELLS; i++) {
      this.shells.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, groundY: 0 });
      this.shellMesh.setMatrixAt(i, this.hidden);
    }
    this.group.add(this.shellMesh);

    const dustTex = softTexture(64, 1, 3);
    const sparkTex = softTexture(32);
    this.textures.push(dustTex, sparkTex);
    this.dust = new Particles(900, dustTex, { renderOrder: 3 });
    this.sparks = new Particles(320, sparkTex, { additive: true, renderOrder: 4 });
    this.group.add(this.dust.points, this.sparks.points);
    scene.add(this.group);
  }

  /** Active particle count (tests / debug). */
  get particleCount(): number {
    return this.dust.count + this.sparks.count;
  }

  get fieldVisualCount(): number {
    return this.visuals.size;
  }

  update(frameDt: number, sim: SimApi, logic: KitLogic): void {
    this.updatePreview(sim, logic);
    const now = sim.time;
    const fields = logic.systems.shrapnel.fields;
    for (const f of fields) {
      let vis = this.visuals.get(f.id);
      if (!vis) {
        vis = this.acquireVisual(f.id);
        this.visuals.set(f.id, vis);
      }
      this.updateField(vis, f, now, frameDt);
    }
    for (const [id, vis] of this.visuals) {
      if (fields.some((f) => f.id === id)) continue;
      // Field gone: fade the ring out, then recycle.
      vis.material.opacity = Math.max(0, vis.material.opacity - frameDt * 1.5);
      if (vis.material.opacity <= 0) {
        vis.edge.mesh.visible = false;
        this.visuals.delete(id);
        this.spare.push(vis);
      }
    }
    this.updateShells(frameDt);
    this.dust.update(frameDt);
    this.sparks.update(frameDt);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const d of [this.previewEdge, this.previewFill, this.previewCenter]) d.dispose();
    for (const m of [this.edgeMat, this.fillMat, this.centerMat, this.shellMat]) m.dispose();
    for (const vis of [...this.visuals.values(), ...this.spare]) {
      vis.edge.dispose();
      vis.material.dispose();
    }
    this.shellGeo.dispose();
    this.shellMesh.dispose();
    this.dust.dispose();
    this.sparks.dispose();
    for (const t of this.textures) t.dispose();
  }

  // --- preview ---------------------------------------------------------------------------------

  private setPreviewVisible(on: boolean): void {
    this.previewEdge.mesh.visible = on;
    this.previewFill.mesh.visible = on;
    this.previewCenter.mesh.visible = on;
  }

  private updatePreview(sim: SimApi, logic: KitLogic): void {
    if (!logic.previewVisible()) {
      this.setPreviewVisible(false);
      return;
    }
    const hero = sim.player();
    const level = Math.max(1, skillLevel(hero, SHRAPNEL));
    const radius = levelValue(SNIPER_SHRAPNEL, 'radius', level);
    const aim = logic.shrapnelAim();
    const charged = (hero.hero?.charges[SHRAPNEL] ?? 0) > 0;
    const strong = logic.shrapnelArmed || logic.player.input.isDown('shrapnel');
    const color = !charged ? 0xff4a3a : strong ? 0xffb347 : 0xffe2a8;
    const k = aim.clamped ? 0.6 : 1;
    this.edgeMat.color.setHex(color);
    this.fillMat.color.setHex(color);
    this.centerMat.color.setHex(color);
    this.edgeMat.opacity = (strong ? 0.85 : 0.32) * k;
    this.fillMat.opacity = (strong ? 0.12 : 0.045) * k;
    this.centerMat.opacity = (strong ? 0.9 : 0.4) * k;
    this.previewEdge.set(this.heightAt, aim.x, aim.y, radius - (strong ? 7 : 4), radius + (strong ? 7 : 4), 6);
    this.previewFill.set(this.heightAt, aim.x, aim.y, 0, radius, 5);
    this.previewCenter.set(this.heightAt, aim.x, aim.y, 14, 22, 6);
    this.setPreviewVisible(true);
  }

  // --- fields ----------------------------------------------------------------------------------

  private acquireVisual(fieldId: number): FieldVisual {
    const vis =
      this.spare.pop() ??
      ((): FieldVisual => {
        const material = new MeshBasicMaterial({
          color: 0xd29a52,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          fog: false,
        });
        const edge = new DrapedAnnulus(material, 96, 1);
        this.group.add(edge.mesh);
        return { id: this.nextVisualId++, edge, material, shellAcc: 0, dustAcc: 0, ticksSeen: 0, pulse: 0, placed: false };
      })();
    vis.id = fieldId;
    vis.shellAcc = 0;
    vis.dustAcc = 0;
    vis.ticksSeen = 0;
    vis.pulse = 0;
    vis.placed = false;
    vis.material.opacity = 0;
    vis.edge.mesh.visible = true;
    return vis;
  }

  private updateField(vis: FieldVisual, f: ShrapnelField, now: number, dt: number): void {
    if (!vis.placed) {
      vis.edge.set(this.heightAt, f.x, f.y, f.radius - 10, f.radius + 10, 6);
      vis.placed = true;
    }
    const t = now - f.startAt;
    const remaining = f.endAt - now;
    if (f.ticksDone > vis.ticksSeen) {
      vis.ticksSeen = f.ticksDone;
      vis.pulse = 1;
    }
    vis.pulse = Math.max(0, vis.pulse - dt * 2.5);
    const fadeIn = Math.min(1, t / 0.35);
    const fadeOut = Math.min(1, Math.max(0, remaining) / 0.6);
    vis.material.opacity = (0.32 + 0.4 * vis.pulse) * fadeIn * fadeOut;

    // Shells: a heavy opening volley that lands as the first tick hits, then a steady rain.
    const firstTick = f.nextTickAt - f.ticksDone * f.interval;
    const volley = now < firstTick;
    const rate = remaining <= 0 ? 0 : volley ? 46 : 11;
    vis.shellAcc += rate * dt;
    while (vis.shellAcc >= 1) {
      vis.shellAcc -= 1;
      this.spawnShell(f, volley ? Math.max(0.25, firstTick - now) : 0.35 + Math.random() * 0.25);
    }

    // Dust cloud ring: mostly on the rim, some haze inside.
    const dustRate = remaining > 0.8 ? 34 : 0;
    vis.dustAcc += dustRate * dt;
    while (vis.dustAcc >= 1) {
      vis.dustAcc -= 1;
      const rim = Math.random() < 0.7;
      const a = Math.random() * Math.PI * 2;
      const r = rim ? f.radius * (0.86 + Math.random() * 0.2) : f.radius * Math.sqrt(Math.random()) * 0.85;
      const wx = f.x + Math.cos(a) * r;
      const wy = f.y + Math.sin(a) * r;
      const gz = this.heightAt(wx, wy);
      this.dust.spawn({
        x: wx,
        y: gz + 30 + Math.random() * 50,
        z: -wy,
        vx: Math.cos(a) * 12,
        vy: 14 + Math.random() * 18,
        vz: -Math.sin(a) * 12,
        life: 2.2 + Math.random() * 1.1,
        size0: 110 + Math.random() * 60,
        size1: 220 + Math.random() * 110,
        alpha: rim ? 0.42 : 0.24,
        color: DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0]!,
        spin: (Math.random() - 0.5) * 0.6,
        fadeIn: 0.25,
      });
    }
  }

  // --- shells ----------------------------------------------------------------------------------

  /** Spawns a shell that reaches the ground inside the field after `flight` seconds. */
  private spawnShell(f: ShrapnelField, flight: number): void {
    const s = this.shells[this.shellCursor]!;
    this.shellCursor = (this.shellCursor + 1) % SHELLS;
    const a = Math.random() * Math.PI * 2;
    const r = f.radius * Math.sqrt(Math.random()) * 0.95;
    const wx = f.x + Math.cos(a) * r;
    const wy = f.y + Math.sin(a) * r;
    const gy = this.heightAt(wx, wy);
    const fall = 1100 + Math.random() * 500;
    const tilt = 0.18;
    const dx = (Math.random() - 0.5) * fall * tilt;
    const dz = (Math.random() - 0.5) * fall * tilt;
    const tFlight = Math.max(0.05, flight);
    s.active = true;
    s.x = wx - dx;
    s.y = gy + fall;
    s.z = -wy - dz;
    s.vx = dx / tFlight;
    s.vy = -fall / tFlight;
    s.vz = dz / tFlight;
    s.groundY = gy;
  }

  private updateShells(dt: number): void {
    const mesh = this.shellMesh;
    for (let i = 0; i < SHELLS; i++) {
      const s = this.shells[i]!;
      if (!s.active) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y <= s.groundY + 2) {
        s.active = false;
        mesh.setMatrixAt(i, this.hidden);
        this.impact(s.x, s.groundY, s.z);
        continue;
      }
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      this.v.set(-s.vx / speed, -s.vy / speed, -s.vz / speed);
      this.q.setFromUnitVectors(this.up, this.v);
      this.m4.compose(this.v.set(s.x, s.y, s.z), this.q, this.s.set(1, Math.min(SHELL_LENGTH, speed * 0.05), 1));
      mesh.setMatrixAt(i, this.m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private impact(x: number, y: number, z: number): void {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.dust.spawn({
        x,
        y: y + 10,
        z,
        vx: Math.cos(a) * 60,
        vy: 40 + Math.random() * 50,
        vz: Math.sin(a) * 60,
        life: 0.7 + Math.random() * 0.4,
        size0: 30,
        size1: 120 + Math.random() * 40,
        alpha: 0.55,
        color: DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0]!,
        drag: 2.5,
        fadeIn: 0.05,
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.spawn({
        x,
        y: y + 6,
        z,
        vx: Math.cos(a) * (80 + Math.random() * 160),
        vy: 120 + Math.random() * 220,
        vz: Math.sin(a) * (80 + Math.random() * 160),
        life: 0.22 + Math.random() * 0.18,
        size0: 26,
        size1: 8,
        alpha: 1,
        color: SPARK_COLOR,
        gravity: -900,
        fadeIn: 0.01,
      });
    }
    this.sparks.spawn({ x, y: y + 12, z, life: 0.12, size0: 70, size1: 110, alpha: 0.9, color: SPARK_COLOR, fadeIn: 0.01 });
  }
}
