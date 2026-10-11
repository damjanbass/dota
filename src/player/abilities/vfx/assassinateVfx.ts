// Assassinate visuals: red laser sight while aiming, the big muzzle flash, and a glowing tracer bullet with a smoke
// trail that follows the sim's homing projectile to its target. Positions in three.js space. Render-only.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Scene, Texture } from 'three';
import { vecToThree } from '../../../core/coords';
import type { SimApi } from '../../../core/sim';
import { Particles, softTexture } from './particles';

const BULLETS = 3;
const TRAIL_SPACING = 22;
const TRAIL_COLOR = new Color(0xff6a3a);
const SMOKE_COLOR = new Color(0x8a8a8a);
const IMPACT_COLOR = new Color(0xffd0a0);

interface Bullet {
  active: boolean;
  projectileId: number;
  targetId: number;
  speed: number;
  pos: Vector3;
  mesh: Mesh;
  trailAcc: number;
  arrived: number;
}

export class AssassinateVfx {
  readonly group = new Group();
  private readonly laserGeo: BoxGeometry;
  private readonly laserMat: MeshBasicMaterial;
  private readonly laser: Mesh;
  private readonly dot: Sprite;
  private readonly flash: Sprite;
  private flashAge = Infinity;
  private readonly coreGeo: BoxGeometry;
  private readonly coreMat: MeshBasicMaterial;
  private readonly bullets: Bullet[] = [];
  private readonly trail: Particles;
  private readonly smoke: Particles;
  private readonly textures: Texture[] = [];
  private readonly tmp = new Vector3();
  private readonly dir = new Vector3();

  constructor(private readonly scene: Scene) {
    const glow = softTexture(64);
    const smokeTex = softTexture(64, 1, 7);
    this.textures.push(glow, smokeTex);

    this.laserGeo = new BoxGeometry(1, 1, 1);
    this.laserGeo.translate(0, 0, 0.5);
    this.laserMat = new MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.laser = new Mesh(this.laserGeo, this.laserMat);
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    this.dot = new Sprite(new SpriteMaterial({ map: glow, color: 0xff3030, blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.dot.visible = false;
    this.flash = new Sprite(new SpriteMaterial({ map: glow, color: 0xffd890, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false, transparent: true }));
    this.flash.visible = false;
    this.flash.renderOrder = 10;

    this.coreGeo = new BoxGeometry(2.6, 2.6, 70);
    this.coreMat = new MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < BULLETS; i++) {
      const mesh = new Mesh(this.coreGeo, this.coreMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.bullets.push({ active: false, projectileId: -1, targetId: -1, speed: 0, pos: new Vector3(), mesh, trailAcc: 0, arrived: 0 });
    }
    this.trail = new Particles(500, glow, { additive: true, renderOrder: 5 });
    this.smoke = new Particles(300, smokeTex, { renderOrder: 4 });
    this.group.add(this.laser, this.dot, this.flash, this.trail.points, this.smoke.points);
    scene.add(this.group);
  }

  get activeBullets(): number {
    return this.bullets.filter((b) => b.active).length;
  }

  /** Laser from the muzzle to the aim point. `locked` brightens it, `progress` 0..1 thickens it. */
  setLaser(from: Vector3, to: Vector3, locked: boolean, progress: number): void {
    const len = from.distanceTo(to);
    if (len < 1) {
      this.hideLaser();
      return;
    }
    const w = locked ? 0.9 + progress * 1.4 : 0.6;
    this.laser.position.copy(from);
    this.laser.lookAt(to);
    this.laser.scale.set(w, w, len);
    this.laserMat.opacity = locked ? 0.55 + 0.35 * progress : 0.3;
    this.laser.visible = true;
    this.dot.position.copy(to);
    const ds = Math.max(6, len * 0.012) * (locked ? 1.4 : 1);
    this.dot.scale.set(ds, ds, 1);
    this.dot.visible = true;
  }

  hideLaser(): void {
    this.laser.visible = false;
    this.dot.visible = false;
  }

  /** Big muzzle flash at the (three-space) muzzle. */
  muzzleFlash(at: Vector3): void {
    this.flash.position.copy(at);
    this.flashAge = 0;
    this.flash.visible = true;
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 40, vy: 20 + Math.random() * 30, vz: (Math.random() - 0.5) * 40, life: 0.9, size0: 10, size1: 60, alpha: 0.35, color: SMOKE_COLOR, drag: 1.5 });
    }
  }

  /** Starts a tracer bullet for a sim projectile, from the muzzle. */
  launch(projectileId: number, targetId: number, speed: number, from: Vector3): void {
    const b = this.bullets.find((x) => !x.active) ?? this.bullets[0]!;
    b.active = true;
    b.projectileId = projectileId;
    b.targetId = targetId;
    b.speed = speed;
    b.pos.copy(from);
    b.trailAcc = 0;
    b.arrived = 0;
    b.mesh.visible = true;
  }

  /** The sim projectile hit: burst at the bullet and retire it. */
  hit(projectileId: number, sim: SimApi): void {
    const b = this.bullets.find((x) => x.active && x.projectileId === projectileId);
    if (!b) return;
    const t = sim.get(b.targetId);
    if (t) this.targetPoint(sim, b.targetId, b.pos);
    this.burst(b.pos);
    b.active = false;
    b.mesh.visible = false;
  }

  update(frameDt: number, sim: SimApi): void {
    if (this.flashAge < 0.14) {
      this.flashAge += frameDt;
      const k = Math.min(1, this.flashAge / 0.14);
      const s = 70 * (1 - k * 0.4);
      this.flash.scale.set(s, s, 1);
      this.flash.material.opacity = 1 - k;
      if (k >= 1) this.flash.visible = false;
    }
    for (const b of this.bullets) {
      if (!b.active) continue;
      if (!sim.get(b.targetId)) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const goal = this.targetPoint(sim, b.targetId, this.tmp);
      this.dir.subVectors(goal, b.pos);
      const d = this.dir.length();
      const step = b.speed * frameDt;
      const prevX = b.pos.x;
      const prevY = b.pos.y;
      const prevZ = b.pos.z;
      if (d <= step) {
        b.pos.copy(goal);
        b.arrived += frameDt;
        // The sim reports the hit within a tick; don't hang around if the event never comes.
        if (b.arrived > 0.5) {
          this.burst(b.pos);
          b.active = false;
          b.mesh.visible = false;
          continue;
        }
      } else {
        b.pos.addScaledVector(this.dir, step / d);
      }
      b.mesh.position.copy(b.pos);
      if (d > 1) b.mesh.lookAt(goal);
      // Trail: glowing streak particles laid along the path travelled this frame.
      const travelled = Math.hypot(b.pos.x - prevX, b.pos.y - prevY, b.pos.z - prevZ);
      b.trailAcc += travelled;
      while (b.trailAcc >= TRAIL_SPACING) {
        b.trailAcc -= TRAIL_SPACING;
        const k = travelled > 0 ? 1 - b.trailAcc / travelled : 0;
        const x = prevX + (b.pos.x - prevX) * k;
        const y = prevY + (b.pos.y - prevY) * k;
        const z = prevZ + (b.pos.z - prevZ) * k;
        this.trail.spawn({ x, y, z, life: 0.32, size0: 16, size1: 5, alpha: 0.85, color: TRAIL_COLOR, fadeIn: 0.01 });
        if (Math.random() < 0.25) this.smoke.spawn({ x, y, z, vy: 10, life: 1.1, size0: 8, size1: 34, alpha: 0.18, color: SMOKE_COLOR });
      }
    }
    this.trail.update(frameDt);
    this.smoke.update(frameDt);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.laserGeo.dispose();
    this.laserMat.dispose();
    this.coreGeo.dispose();
    this.coreMat.dispose();
    this.dot.material.dispose();
    this.flash.material.dispose();
    this.trail.dispose();
    this.smoke.dispose();
    for (const t of this.textures) t.dispose();
  }

  private targetPoint(sim: SimApi, id: number, out: Vector3): Vector3 {
    const u = sim.get(id)!;
    return vecToThree(u.position, out).setY(out.y + u.def.height * 0.55);
  }

  private burst(at: Vector3): void {
    this.trail.spawn({ x: at.x, y: at.y, z: at.z, life: 0.18, size0: 60, size1: 140, alpha: 1, color: IMPACT_COLOR, fadeIn: 0.01 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI * 0.5;
      const sp = 150 + Math.random() * 250;
      this.trail.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 60, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.3 + Math.random() * 0.2, size0: 12, size1: 4, alpha: 1, color: TRAIL_COLOR, gravity: -500, fadeIn: 0.01 });
    }
    for (let i = 0; i < 4; i++) {
      this.smoke.spawn({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 60, vy: 30, vz: (Math.random() - 0.5) * 60, life: 1, size0: 20, size1: 80, alpha: 0.3, color: SMOKE_COLOR, drag: 1 });
    }
  }
}
