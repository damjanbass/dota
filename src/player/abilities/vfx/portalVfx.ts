// Town Portal visuals: a rising swirl around the player's feet while channeling, a light beam + ground ring at the
// destination (visible from afar, like DotA's TP effect), and a burst on arrival. Render-only.
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Scene, Texture } from 'three';
import { DrapedAnnulus } from './drape';
import type { HeightFn } from './drape';
import { Particles, beamTexture, softTexture } from './particles';

const SWIRL = new Color(0x7fd8ff);
const SWIRL_HOT = new Color(0xe8f8ff);
const BEAM_HEIGHT = 900;

export class PortalVfx {
  readonly group = new Group();
  private readonly swirl: Particles;
  private readonly beamGeo: CylinderGeometry;
  private readonly beamMat: MeshBasicMaterial;
  private readonly beam: Mesh;
  private readonly ringMat: MeshBasicMaterial;
  private readonly ring: DrapedAnnulus;
  private readonly textures: Texture[] = [];
  private emitAcc = 0;
  private angle = 0;
  private placedAt = '';

  constructor(
    private readonly scene: Scene,
    private readonly heightAt: HeightFn,
  ) {
    const glow = softTexture(32);
    const beamTex = beamTexture();
    this.textures.push(glow, beamTex);
    this.swirl = new Particles(420, glow, { additive: true, renderOrder: 5 });
    this.beamGeo = new CylinderGeometry(55, 70, BEAM_HEIGHT, 24, 1, true);
    this.beamGeo.translate(0, BEAM_HEIGHT / 2, 0);
    this.beamMat = new MeshBasicMaterial({ map: beamTex, color: 0x8fdcff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
    this.beam = new Mesh(this.beamGeo, this.beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.ringMat = new MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
    this.ring = new DrapedAnnulus(this.ringMat, 64, 1);
    this.ring.mesh.visible = false;
    this.group.add(this.swirl.points, this.beam, this.ring.mesh);
    scene.add(this.group);
  }

  /**
   * @param channel null when not channeling; otherwise progress 0..1, the player's feet and the landing spot (WC3).
   */
  update(frameDt: number, channel: { progress: number; feet: { x: number; y: number; z: number }; landing: { x: number; y: number } } | null): void {
    if (channel) {
      const { progress, feet, landing } = channel;
      this.angle += frameDt * (3 + progress * 6);
      this.emitAcc += frameDt * (60 + progress * 120);
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const a = this.angle + Math.random() * Math.PI * 2;
        const r = 34 + Math.random() * 30;
        // three = (x, z, -y)
        this.swirl.spawn({
          x: feet.x + Math.cos(a) * r,
          y: feet.z + 4 + Math.random() * 10,
          z: -(feet.y + Math.sin(a) * r),
          vx: -Math.sin(a) * 90,
          vy: 60 + Math.random() * 90 + progress * 60,
          vz: -Math.cos(a) * 90,
          life: 0.7 + Math.random() * 0.4,
          size0: 9,
          size1: 3,
          alpha: 0.9,
          color: Math.random() < 0.3 ? SWIRL_HOT : SWIRL,
          drag: 0.8,
          fadeIn: 0.1,
        });
      }
      const key = `${landing.x.toFixed(0)},${landing.y.toFixed(0)}`;
      if (key !== this.placedAt) {
        this.placedAt = key;
        this.ring.set(this.heightAt, landing.x, landing.y, 70, 90, 4);
        this.beam.position.set(landing.x, this.heightAt(landing.x, landing.y), -landing.y);
      }
      this.beam.visible = true;
      this.ring.mesh.visible = true;
      this.beam.rotation.y += frameDt * 1.5;
      this.beamMat.opacity = 0.25 + 0.6 * progress;
      this.ringMat.opacity = 0.3 + 0.6 * progress;
      this.beam.scale.set(1 - progress * 0.35, 0.6 + progress * 0.4, 1 - progress * 0.35);
    } else {
      this.beamMat.opacity = Math.max(0, this.beamMat.opacity - frameDt * 2);
      this.ringMat.opacity = this.beamMat.opacity;
      if (this.beamMat.opacity <= 0) {
        this.beam.visible = false;
        this.ring.mesh.visible = false;
        this.placedAt = '';
      }
    }
    this.swirl.update(frameDt);
  }

  /** Burst at the arrival point (WC3 feet position). */
  arrive(x: number, y: number, z: number): void {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 160;
      this.swirl.spawn({ x, y: z + 10 + Math.random() * 60, z: -y, vx: Math.cos(a) * sp, vy: 40 + Math.random() * 120, vz: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, size0: 12, size1: 3, alpha: 1, color: i % 3 === 0 ? SWIRL_HOT : SWIRL, drag: 2 });
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.swirl.dispose();
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.ringMat.dispose();
    this.ring.dispose();
    for (const t of this.textures) t.dispose();
  }
}
