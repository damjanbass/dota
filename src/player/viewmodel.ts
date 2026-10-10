// First-person rifle + dwarf hands, procedural low-poly in a WC3-ish palette. Drawn in its own pass (own scene +
// camera, depth cleared) so it never clips into walls. Animates bob, look sway, recoil kick, bolt cycle,
// shell ejection and muzzle flash. View space: camera at origin looking down -Z, +X right, +Y up, ~inches.
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { BufferGeometry, Material, WebGLRenderer } from 'three';
import { DEG, clamp } from './math';

const PALETTE = {
  wood: 0x7b4a26,
  woodDark: 0x5a3519,
  brass: 0xd1a03a,
  steel: 0x4a4c55,
  leather: 0x6b4424,
  cloth: 0x3f6a3c,
  lens: 0x1d3b6a,
  dark: 0x2c2e34,
};

/** Rest position of the rifle in view space. */
const REST = new Vector3(8.6, -10.4, -19);
const REST_ROT = new Vector3(0.015, 0.012, 0);
/** Muzzle tip in rifle-local space. */
const MUZZLE_LOCAL = new Vector3(0, 0.4, -57);

export interface ViewmodelFrame {
  frameDt: number;
  speed2d: number;
  onGround: boolean;
  /** View-angle change since last frame (radians). */
  dYaw: number;
  dPitch: number;
  scoped: boolean;
}

const smooth = (a: number, b: number, t: number): number => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

export class Viewmodel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly rig = new Group();
  private readonly rifle = new Group();
  private readonly bolt = new Group();
  private readonly rightHand = new Group();
  private readonly flash: Mesh;
  private readonly flashLight: PointLight;
  private readonly shells: Array<{ mesh: Mesh; vel: Vector3; spin: Vector3; life: number }> = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: CanvasTexture[] = [];

  private time = 0;
  private bobTime = 0;
  private bobSpeed = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private kickTime = Infinity;
  private flashTime = Infinity;
  private boltTime = Infinity;
  private boltDuration = 0.8;
  private shellEjected = true;
  private shellIndex = 0;
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(62, aspect, 0.5, 300);
    this.scene.add(new HemisphereLight(0xe8eeff, 0x4a3a28, 1.6));
    const sun = new DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-3, 6, 4);
    this.scene.add(sun);
    this.flashLight = new PointLight(0xffc070, 0, 120, 1);
    this.scene.add(this.flashLight);

    this.buildRifle();
    this.buildHands();
    this.rifle.add(this.bolt, this.rightHand);
    this.rig.add(this.rifle);
    this.scene.add(this.rig);

    // Muzzle flash: two crossed additive star planes + a camera-facing disc.
    const flashTex = this.track(makeFlashTexture());
    const flashMat = this.mat(
      new MeshBasicMaterial({ map: flashTex, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.flash = new Mesh(this.geo(new PlaneGeometry(9, 9)), flashMat);
    const side = new Mesh(this.geo(new PlaneGeometry(14, 6)), flashMat);
    side.rotation.y = Math.PI / 2;
    side.position.z = -2.5;
    const side2 = side.clone();
    side2.rotation.z = Math.PI / 2;
    this.flash.add(side, side2);
    this.flash.position.copy(MUZZLE_LOCAL);
    this.flash.visible = false;
    this.rifle.add(this.flash);

    const shellGeo = this.geo(new CylinderGeometry(0.28, 0.28, 1.6, 6));
    const shellMat = this.mat(new MeshPhongMaterial({ color: PALETTE.brass, shininess: 80, flatShading: true }));
    for (let i = 0; i < 3; i++) {
      const mesh = new Mesh(shellGeo, shellMat);
      mesh.visible = false;
      this.rig.add(mesh);
      this.shells.push({ mesh, vel: new Vector3(), spin: new Vector3(), life: 0 });
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Starts recoil, flash and (after a short delay) the bolt cycle sized to the fire interval. */
  onFire(fireInterval: number): void {
    this.kickTime = 0;
    this.flashTime = 0;
    this.boltTime = -0.16;
    this.boltDuration = clamp(fireInterval * 0.55, 0.45, 0.95);
    this.shellEjected = false;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s);
  }

  update(f: ViewmodelFrame): void {
    const dt = f.frameDt;
    this.time += dt;
    this.rig.visible = !f.scoped;

    // --- CS V_CalcBob (cl_bob 0.01, cl_bobcycle 0.8, cl_bobup 0.5) --------------------------------
    const targetSpeed = f.onGround ? f.speed2d : 0;
    this.bobSpeed += (targetSpeed - this.bobSpeed) * Math.min(1, dt * 12);
    this.bobTime += dt;
    let cycle = (this.bobTime % 0.8) / 0.8;
    cycle = cycle < 0.5 ? (Math.PI * cycle) / 0.5 : Math.PI + (Math.PI * (cycle - 0.5)) / 0.5;
    const bobBase = this.bobSpeed * 0.01;
    const bob = clamp(bobBase * 0.3 + bobBase * 0.7 * Math.sin(cycle), -7, 4);
    const lateral = Math.sin(cycle * 0.5) * bobBase * 0.35;

    // --- look sway: the rifle lags behind view rotation ---------------------------------------
    const inv = dt > 1e-4 ? 1 / dt : 0;
    const targetYaw = clamp(f.dYaw * inv * 0.012, -0.09, 0.09);
    const targetPitch = clamp(f.dPitch * inv * 0.012, -0.07, 0.07);
    const k = Math.min(1, dt * 9);
    this.swayYaw += (targetYaw - this.swayYaw) * k;
    this.swayPitch += (targetPitch - this.swayPitch) * k;

    // --- recoil kick ------------------------------------------------------------------------
    this.kickTime += dt;
    const kt = this.kickTime;
    const kick = kt < 0.035 ? kt / 0.035 : Math.exp(-(kt - 0.035) * 9);

    // --- bolt cycle ---------------------------------------------------------------------------
    this.boltTime += dt;
    const u = this.boltTime >= 0 && this.boltTime < this.boltDuration ? this.boltTime / this.boltDuration : -1;
    let lift = 0;
    let pull = 0;
    let reach = 0;
    let cant = 0;
    if (u >= 0) {
      reach = smooth(0, 0.15, u) * (1 - smooth(0.85, 1, u));
      lift = smooth(0.13, 0.3, u) * (1 - smooth(0.7, 0.86, u));
      pull = smooth(0.3, 0.5, u) * (1 - smooth(0.52, 0.7, u));
      cant = Math.sin(Math.PI * smooth(0, 1, u));
      if (!this.shellEjected && u > 0.45) {
        this.shellEjected = true;
        this.ejectShell();
      }
    }
    this.bolt.rotation.z = lift * 80 * DEG;
    this.bolt.position.z = pull * 4.5;
    this.rightHand.position.set(reach * 2.2 + pull * 0, reach * 2.6, reach * -4.6 + pull * 4.5);
    this.rightHand.rotation.z = reach * 0.5;

    // --- compose -------------------------------------------------------------------------------
    const idle = Math.sin(this.time * 1.6) * 0.12;
    this.rig.position.set(
      REST.x + lateral - this.swayYaw * 18,
      REST.y + bob * 0.55 + idle - this.swayPitch * 14 - cant * 1.2,
      REST.z + bob * 0.4 * 0.5 + kick * 3.2,
    );
    this.rig.rotation.set(
      REST_ROT.x - this.swayPitch + kick * 0.11 - bob * 0.3 * DEG,
      REST_ROT.y - this.swayYaw - bob * 0.5 * DEG,
      REST_ROT.z - bob * 1 * DEG - cant * 0.22,
      'YXZ',
    );

    // --- muzzle flash -------------------------------------------------------------------------
    this.flashTime += dt;
    const flashOn = this.flashTime < 0.05;
    this.flash.visible = flashOn;
    this.flashLight.intensity = flashOn ? 30 * (1 - this.flashTime / 0.05) : 0;
    if (flashOn) {
      this.flash.updateWorldMatrix(true, false);
      this.flashLight.position.setFromMatrixPosition(this.flash.matrixWorld);
    }

    // --- shells -------------------------------------------------------------------------------
    for (const s of this.shells) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 260 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.z += s.spin.z * dt;
    }
  }

  /** Draws the viewmodel over the already-rendered world (depth cleared first). */
  render(renderer: WebGLRenderer): void {
    if (!this.rig.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** Muzzle position in normalised device coordinates of the viewmodel camera (for lining up tracers). */
  muzzleNdc(out: Vector3): Vector3 {
    this.rig.updateWorldMatrix(true, true);
    out.copy(MUZZLE_LOCAL).applyMatrix4(this.rifle.matrixWorld);
    return out.project(this.camera);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }

  // --- construction -----------------------------------------------------------------------------

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private track(t: CanvasTexture): CanvasTexture {
    this.textures.push(t);
    return t;
  }

  private box(parent: Object3D, w: number, h: number, d: number, m: Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
    const mesh = new Mesh(this.geo(new BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  }

  /** Cylinder along Z. rBack faces the camera (+Z), rFront faces the muzzle (-Z). */
  private tube(parent: Object3D, rBack: number, rFront: number, len: number, segs: number, m: Material, x: number, y: number, z: number): Mesh {
    const g = this.geo(new CylinderGeometry(rBack, rFront, len, segs));
    g.rotateX(Math.PI / 2);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Cylinder between two points (limbs). */
  private limb(parent: Object3D, a: Vector3, b: Vector3, r0: number, r1: number, m: Material): Mesh {
    const dir = this.tmpV.copy(b).sub(a);
    const len = dir.length();
    const g = this.geo(new CylinderGeometry(r1, r0, len, 7));
    const mesh = new Mesh(g, m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.copy(this.tmpQ.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
    parent.add(mesh);
    return mesh;
  }

  private buildRifle(): void {
    const wood = this.mat(new MeshLambertMaterial({ color: PALETTE.wood, flatShading: true }));
    const woodDark = this.mat(new MeshLambertMaterial({ color: PALETTE.woodDark, flatShading: true }));
    const brass = this.mat(new MeshPhongMaterial({ color: PALETTE.brass, specular: 0x6a4a10, shininess: 70, flatShading: true }));
    const steel = this.mat(new MeshPhongMaterial({ color: PALETTE.steel, specular: 0x555566, shininess: 50, flatShading: true }));
    const dark = this.mat(new MeshPhongMaterial({ color: PALETTE.dark, specular: 0x444450, shininess: 60, flatShading: true }));
    const lens = this.mat(new MeshPhongMaterial({ color: PALETTE.lens, specular: 0x99bbff, shininess: 120, emissive: new Color(0x0a1830) }));
    const r = this.rifle;

    // Receiver, barrel with brass bands and a flared dwarven muzzle.
    this.box(r, 2.5, 2.7, 10, steel, 0, 0, -4);
    this.box(r, 2.7, 0.6, 9, brass, 0, 1.45, -4.2);
    this.box(r, 2.7, 1.2, 1.2, brass, 0, 0, -9.2);
    this.tube(r, 0.85, 0.75, 46, 8, steel, 0, 0.4, -32);
    for (const z of [-15, -27, -39, -49]) this.tube(r, 1.12, 1.12, 1.1, 8, brass, 0, 0.4, z);
    this.tube(r, 0.95, 1.65, 3.4, 8, brass, 0, 0.4, -55.2);
    this.tube(r, 1.7, 1.7, 0.5, 8, steel, 0, 0.4, -56.9);

    // Wooden furniture: forend, wrist, chunky stock with a brass butt plate and cheek rest.
    this.box(r, 2.3, 1.9, 22, wood, 0, -1.35, -20);
    this.box(r, 2.5, 0.5, 21, woodDark, 0, -0.45, -20);
    this.box(r, 2.1, 2.8, 6, wood, 0, -1.7, 3.4, -0.2);
    this.box(r, 2.6, 5, 10, wood, 0, -3.2, 10.5, -0.14);
    this.box(r, 2.75, 1.4, 6.5, woodDark, 0, -0.9, 10.8, -0.1);
    this.box(r, 2.8, 5.3, 0.7, brass, 0, -3.6, 15.6, -0.14);
    this.box(r, 0.3, 1.2, 4, brass, 1.35, -3.0, 10.5, -0.14);

    // Trigger guard + trigger.
    this.box(r, 0.45, 0.45, 3.6, brass, 0, -2.6, -1.6);
    this.box(r, 0.35, 1.3, 0.35, steel, 0, -1.9, -1.1, 0.3);

    // Brass gear on the receiver (Keen engineering).
    const gear = this.tube(r, 1.2, 1.2, 0.5, 8, brass, 1.45, 0.1, -6.5);
    gear.rotation.y = Math.PI / 2;
    this.tube(r, 0.45, 0.45, 0.8, 6, steel, 1.6, 0.1, -6.5).rotation.y = Math.PI / 2;

    // Scope: tube, bells, lenses, turrets, mounts.
    const sy = 3.0;
    this.tube(r, 1.0, 1.0, 15, 8, dark, 0, sy, -6.5);
    for (const z of [-1.5, -11.5]) this.tube(r, 1.18, 1.18, 0.8, 8, brass, 0, sy, z);
    this.tube(r, 1.35, 1.0, 2.6, 8, brass, 0, sy, 2.2);
    this.tube(r, 1.0, 1.6, 3.2, 8, brass, 0, sy, -15.5);
    for (const z of [-2.5, -10.5]) this.box(r, 0.9, 1.7, 1.3, steel, 0, 1.75, z);
    const turret = new Mesh(this.geo(new CylinderGeometry(0.55, 0.55, 1.3, 6)), steel);
    turret.position.set(0, sy + 1.3, -6.5);
    r.add(turret);
    const turret2 = this.tube(r, 0.55, 0.55, 1.3, 6, steel, 1.3, sy, -6.5);
    turret2.rotation.y = Math.PI / 2;
    const eye = new Mesh(this.geo(new CircleGeometry(1.18, 10)), lens);
    eye.position.set(0, sy, 3.55);
    r.add(eye);
    const front = new Mesh(this.geo(new CircleGeometry(1.42, 10)), lens);
    front.position.set(0, sy, -17.15);
    front.rotation.y = Math.PI;
    r.add(front);

    // Bolt: pivots around the bore axis (rotation.z lifts the handle), slides back along +Z.
    this.bolt.position.set(0, 0.4, -3);
    const handle = new Mesh(this.geo(new CylinderGeometry(0.3, 0.3, 3.3, 6)), steel);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(1.65, 0, 0);
    this.bolt.add(handle);
    const knob = new Mesh(this.geo(new SphereGeometry(0.7, 7, 5)), brass);
    knob.position.set(3.4, 0, 0);
    this.bolt.add(knob);
  }

  private buildHands(): void {
    const leather = this.mat(new MeshLambertMaterial({ color: PALETTE.leather, flatShading: true }));
    const cloth = this.mat(new MeshLambertMaterial({ color: PALETTE.cloth, flatShading: true }));
    const brass = this.mat(new MeshPhongMaterial({ color: PALETTE.brass, specular: 0x6a4a10, shininess: 70, flatShading: true }));
    const r = this.rifle;

    // Left (support) hand cradling the forend: palm under, fingers over the far side, thumb on the near side.
    this.box(r, 3.4, 2.2, 4.6, leather, -0.2, -2.9, -27);
    this.box(r, 1.3, 2.6, 4.2, leather, 1.6, -1.4, -27, 0, 0, -0.15);
    this.box(r, 1.2, 1.1, 3.4, leather, -1.6, -1.2, -26.4, 0, 0.2, 0.2);
    const lWrist = new Vector3(-0.8, -3.6, -24.5);
    const lElbow = new Vector3(-8, -13, -4);
    this.limb(r, lWrist, lElbow, 2.0, 2.7, cloth);
    this.limb(r, lWrist, lWrist.clone().lerp(lElbow, 0.12), 2.35, 2.35, brass);

    // Right (trigger) hand: lives in its own group so it can work the bolt.
    const h = this.rightHand;
    this.box(h, 3.2, 3.3, 3.6, leather, 0.6, -2.5, 2.2);
    this.box(h, 1.2, 1.1, 2.8, leather, -1.1, -0.5, 1.2, 0.1, 0, 0.3);
    this.box(h, 0.9, 0.9, 2.4, leather, 0.3, -1.85, -0.6, -0.4);
    this.box(h, 1.0, 2.2, 1.2, leather, 1.7, -2.6, 0.2);
    const rWrist = new Vector3(1.2, -3.8, 3.8);
    const rElbow = new Vector3(6, -13, 16);
    this.limb(h, rWrist, rElbow, 2.1, 2.8, cloth);
    this.limb(h, rWrist, rWrist.clone().lerp(rElbow, 0.1), 2.45, 2.45, brass);
  }

  private ejectShell(): void {
    const s = this.shells[this.shellIndex++ % this.shells.length]!;
    this.rifle.updateWorldMatrix(true, false);
    // Ejection port on the right of the receiver, expressed in rig space.
    s.mesh.position.set(1.4, 1.0, -4).applyEuler(this.rifle.rotation).add(this.rifle.position);
    s.mesh.rotation.set(Math.PI / 2, 0, 0);
    s.vel.set(40 + Math.random() * 15, 55 + Math.random() * 15, 10);
    s.spin.set(14 + Math.random() * 6, 0, 9);
    s.life = 0.7;
    s.mesh.visible = true;
  }
}

const makeFlashTexture = (): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,210,110,0.9)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g;
  // Star: radial spikes + soft core.
  ctx.beginPath();
  const spikes = 7;
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? c : c * 0.32;
    ctx.lineTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
  }
  ctx.fill();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
};
