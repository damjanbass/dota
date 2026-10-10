// Throwaway debug world for the FPS dev scene: vertex-coloured heightfield, water, instanced tree cylinders and
// placeholder building cylinders. The real renderer is src/world (agent D); nothing here ships in the game.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { toThree } from '../core/coords';
import { PathFlag, TileFlag, groundHeightAt, pathingAt } from '../core/map';
import type { LoadedMap, MapEntityKind } from '../core/map';
import type { Obstacle } from './controller';
import { TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS } from './hitbox';
import type { ShotBlocker } from './hitbox';

export interface DevWorld {
  group: Group;
  dispose(): void;
}

const tileColor = (id: string): number => {
  const s = id.toLowerCase();
  if (/blt|blm|bl[0-9]/.test(s)) return 0x5b4a5e;
  if (/snw|ice|snow/.test(s)) return 0xdfe6ee;
  if (/rck|rok|rock|cbl|stn|bks|brk/.test(s)) return 0x7d7a72;
  if (/drd/.test(s)) return 0x5e4a33;
  if (/drt|dirt|drk|dgr|mud/.test(s)) return 0x7a6343;
  if (/vin|lv|leaf/.test(s)) return 0x3e6a2c;
  if (/grs|grd|gras|grass/.test(s)) return 0x55803a;
  return 0x6c7a4a;
};

export const createDevTerrain = (map: LoadedMap): DevWorld => {
  const group = new Group();
  const disposables: Array<{ dispose(): void }> = [];
  const t = map.data.terrain;
  const { cols, rows } = t;

  // --- ground -------------------------------------------------------------------------------
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const palette = map.data.terrain.groundTextures.map((id) => new Color().setHex(tileColor(id), SRGBColorSpace));
  const tmp = new Vector3();
  const c = new Color();
  const blight = new Color().setHex(0x4a3a52, SRGBColorSpace);
  const dark = new Color().setHex(0x2a2a26, SRGBColorSpace);
  // Heights are absolute WC3 values (real map ≈ 765..1536), so shade relative to the mean ground level.
  let mean = 0;
  for (let i = 0; i < map.height.length; i++) mean += map.height[i]!;
  mean /= Math.max(1, map.height.length);
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iy * cols + ix;
      const x = t.originX + ix * t.cellSize;
      const y = t.originY + iy * t.cellSize;
      const z = map.height[i]!;
      toThree(x, y, z, tmp);
      positions.set([tmp.x, tmp.y, tmp.z], i * 3);
      c.copy(palette[map.texture[i]!] ?? palette[0] ?? new Color(0x55803a));
      if (map.tileFlags[i]! & TileFlag.Blight) c.lerp(blight, 0.55);
      if (pathingAt(map, x, y) & PathFlag.Unwalkable) c.lerp(dark, 0.45);
      // Cheap height shading + a little checker so distance and motion read well.
      const shade = 0.82 + Math.max(-0.25, Math.min(0.25, (z - mean) / 400)) + ((ix + iy) % 2 === 0 ? 0.03 : -0.03);
      colors.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
    }
  }
  const index: number[] = [];
  for (let iy = 0; iy < rows - 1; iy++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = iy * cols + ix;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Three's z = -wc3.y flips handedness, so wind (a, b, d) to face +Y.
      index.push(a, b, d, b, e, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const groundMat = new MeshLambertMaterial({ vertexColors: true });
  const ground = new Mesh(geo, groundMat);
  ground.name = 'dev-terrain';
  group.add(ground);
  disposables.push(geo, groundMat);

  // --- water --------------------------------------------------------------------------------
  const wPos: number[] = [];
  for (let iy = 0; iy < rows - 1; iy++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const corners = [iy * cols + ix, iy * cols + ix + 1, (iy + 1) * cols + ix, (iy + 1) * cols + ix + 1];
      let wz = -Infinity;
      for (const k of corners) if (!Number.isNaN(map.water[k]!)) wz = Math.max(wz, map.water[k]!);
      if (wz === -Infinity) continue;
      const x0 = t.originX + ix * t.cellSize;
      const y0 = t.originY + iy * t.cellSize;
      const x1 = x0 + t.cellSize;
      const y1 = y0 + t.cellSize;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]] as const) wPos.push(x, wz, -y);
    }
  }
  if (wPos.length > 0) {
    const wGeo = new BufferGeometry();
    wGeo.setAttribute('position', new BufferAttribute(new Float32Array(wPos), 3));
    wGeo.computeVertexNormals();
    const wMat = new MeshLambertMaterial({ color: 0x2f6ea8, transparent: true, opacity: 0.6, depthWrite: false });
    group.add(new Mesh(wGeo, wMat));
    disposables.push(wGeo, wMat);
  }

  // --- trees: trunk = the exact shot-blocking cylinder, canopy is decoration -----------------
  const trees = map.data.trees;
  if (trees.length > 0) {
    const trunkGeo = new CylinderGeometry(TREE_TRUNK_RADIUS, TREE_TRUNK_RADIUS * 1.15, TREE_TRUNK_HEIGHT, 7);
    trunkGeo.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
    const canopyGeo = new ConeGeometry(105, 300, 7);
    canopyGeo.translate(0, 120 + 150, 0);
    const trunkMat = new MeshLambertMaterial({ color: 0x6b4a2e, flatShading: true });
    const canopyMat = new MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const trunks = new InstancedMesh(trunkGeo, trunkMat, trees.length);
    const canopies = new InstancedMesh(canopyGeo, canopyMat, trees.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const styleColor: Record<string, number> = { ashenvale: 0x2f6b2a, blight: 0x5a4a62, northrend: 0xc8d4dc, other: 0x3d6b33 };
    trees.forEach(([x, y, z, scale, type, variation], i) => {
      const sc = scale > 0 ? scale : 1;
      q.setFromAxisAngle(new Vector3(0, 1, 0), variation * 0.7);
      m.compose(toThree(x, y, z, tmp), q, s.set(sc, sc, sc));
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
      const style = map.data.treeTypes[type]?.style ?? 'other';
      c.setHex(styleColor[style] ?? 0x3d6b33, SRGBColorSpace).multiplyScalar(0.85 + (variation % 5) * 0.06);
      canopies.setColorAt(i, c);
    });
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();
    group.add(trunks, canopies);
    disposables.push(trunkGeo, canopyGeo, trunkMat, canopyMat, trunks, canopies);
  }

  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};

// ---------------------------------------------------------------------------
// Placeholder buildings (sizes are guesses for the debug range, not DotA data)
// ---------------------------------------------------------------------------

const BUILDING_SIZE: Partial<Record<MapEntityKind, { radius: number; height: number }>> = {
  tower: { radius: 64, height: 380 },
  barracks_melee: { radius: 110, height: 220 },
  barracks_ranged: { radius: 100, height: 200 },
  ancient: { radius: 190, height: 520 },
  fountain: { radius: 110, height: 90 },
  shop: { radius: 70, height: 170 },
  secret_shop: { radius: 70, height: 170 },
  side_shop: { radius: 70, height: 170 },
  tavern: { radius: 110, height: 200 },
};

export interface DevBuildings extends DevWorld {
  obstacles: Obstacle[];
  blockers: ShotBlocker[];
}

export const createDevBuildings = (map: LoadedMap): DevBuildings => {
  const group = new Group();
  const obstacles: Obstacle[] = [];
  const blockers: ShotBlocker[] = [];
  const materials: Material[] = [];
  const geometries: CylinderGeometry[] = [];
  const teamColor = { sentinel: 0x9fb0c8, scourge: 0x7a5f6e, neutral: 0xa89c80 } as const;
  const mats = new Map<string, MeshLambertMaterial>();
  const tmp = new Vector3();
  for (const e of map.data.entities) {
    const size = BUILDING_SIZE[e.kind];
    if (!size) continue;
    const z = groundHeightAt(map, e.x, e.y);
    obstacles.push({ x: e.x, y: e.y, radius: size.radius });
    blockers.push({ x: e.x, y: e.y, z, radius: size.radius, height: size.height });
    let mat = mats.get(e.team);
    if (!mat) {
      mat = new MeshLambertMaterial({ color: teamColor[e.team], flatShading: true });
      mats.set(e.team, mat);
      materials.push(mat);
    }
    const g = new CylinderGeometry(size.radius * 0.85, size.radius, size.height, 8);
    g.translate(0, size.height / 2, 0);
    geometries.push(g);
    const mesh = new Mesh(g, mat);
    mesh.position.copy(toThree(e.x, e.y, z, tmp));
    group.add(mesh);
  }
  return {
    group,
    obstacles,
    blockers,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
};
