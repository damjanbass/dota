// Visual-only homing projectiles (creep arrows, tower bolts, siege shots, Assassinate round).
// The sim decides when they hit; this just flies a glowing dart from source to target.
import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { Scene } from 'three';
import { toThree } from '../core/coords';
import type { EventBus } from '../core/events';
import type { SimApi } from '../core/sim';
import type { GameEvents, Vec3 } from '../core/types';

const COLORS: Record<string, number> = {
  tower_sentinel: 0x9fe7ff,
  tower_scourge: 0x9dff6a,
  assassinate: 0xffd27a,
  default: 0xffe9b0,
};

interface Flight {
  mesh: Mesh;
  pos: Vec3;
  targetId: number;
  speed: number;
}

export interface ProjectileRenderer {
  update(frameDt: number): void;
  dispose(): void;
}

export const createProjectileRenderer = (scene: Scene, sim: SimApi, events: EventBus<GameEvents>): ProjectileRenderer => {
  const geometry = new SphereGeometry(7, 8, 6);
  geometry.scale(2.2, 1, 1);
  const materials = new Map<number, MeshBasicMaterial>();
  const materialFor = (color: number): MeshBasicMaterial => {
    let m = materials.get(color);
    if (!m) {
      m = new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
      materials.set(color, m);
    }
    return m;
  };
  const flights = new Map<number, Flight>();

  const chestZ = (unitId: number): Vec3 | null => {
    const u = sim.get(unitId);
    if (!u) return null;
    return { x: u.position.x, y: u.position.y, z: u.position.z + u.def.height * 0.6 };
  };

  const offLaunch = events.on('projectile:launched', ({ projectileId, sourceId, targetId, visual, speed }) => {
    const start = chestZ(sourceId);
    if (!start) return;
    const mesh = new Mesh(geometry, materialFor(COLORS[visual] ?? COLORS.default!));
    scene.add(mesh);
    flights.set(projectileId, { mesh, pos: start, targetId, speed });
  });
  const offHit = events.on('projectile:hit', ({ projectileId }) => {
    const f = flights.get(projectileId);
    if (!f) return;
    scene.remove(f.mesh);
    flights.delete(projectileId);
  });

  return {
    update(frameDt) {
      for (const [id, f] of flights) {
        const target = chestZ(f.targetId);
        if (!target) {
          scene.remove(f.mesh);
          flights.delete(id);
          continue;
        }
        const dx = target.x - f.pos.x;
        const dy = target.y - f.pos.y;
        const dz = target.z - f.pos.z;
        const dist = Math.hypot(dx, dy, dz);
        const step = Math.min(dist, f.speed * frameDt);
        if (dist > 0) {
          f.pos.x += (dx / dist) * step;
          f.pos.y += (dy / dist) * step;
          f.pos.z += (dz / dist) * step;
        }
        toThree(f.pos.x, f.pos.y, f.pos.z, f.mesh.position);
        f.mesh.rotation.y = Math.atan2(dy, dx);
      }
    },
    dispose() {
      offLaunch();
      offHit();
      for (const f of flights.values()) scene.remove(f.mesh);
      flights.clear();
      geometry.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
};
