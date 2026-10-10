// Instanced trees: one InstancedMesh pair (near + far LOD) per (chunk, tree kind).
// Chunks are 16×16 tiles, so three.js frustum-culls them and LOD switches per chunk by distance.
import { Color, Group, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { toThree } from '../core/coords';
import type { LoadedMap } from '../core/map';
import { createPaintedMaterial } from './materials';
import { hash1 } from './noise';
import { CHUNK_TILES } from './terrain';
import { TREE_KINDS, treeGeometries, treeKindFor } from './treeModels';
import type { TreeKind } from './treeModels';

/** Chunks whose nearest point is closer than this (three.js units) use the detailed mesh. */
export const TREE_NEAR_DISTANCE = 2600;

interface Bucket {
  kind: TreeKind;
  near: InstancedMesh;
  far: InstancedMesh;
  /** Chunk AABB in three.js xz. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  matrices: Float32Array;
}

export interface Trees {
  group: Group;
  count: number;
  /** Per-kind instance counts. */
  kinds: Record<TreeKind, number>;
  update(cameraPos: Vector3): void;
  /** Hide / show a tree by its index in map.data.trees (e.g. when cut down). */
  setTreeVisible(index: number, visible: boolean): void;
  dispose(): void;
}

const TINTS: Record<TreeKind, number[]> = {
  ashen: [0xffffff, 0xc8dcff, 0xe8ffd8, 0xd8f0ff, 0xfff4d8],
  summer: [0xffffff, 0xf0ffd0, 0xffeec8, 0xe0ffe0],
  pine: [0xffffff, 0xd8e8ff, 0xe8f0e8],
  twisted: [0xffffff, 0xf0d8ff, 0xd8e0c8, 0xffe0f0],
};

export const createTrees = (
  map: LoadedMap,
  heightAt: (x: number, y: number) => number,
  isBlight: (x: number, y: number) => boolean,
): Trees => {
  const group = new Group();
  group.name = 'trees';
  const { terrain, trees, treeTypes } = map.data;
  const chunk = CHUNK_TILES * terrain.cellSize;
  const nearMat: MeshLambertMaterial = createPaintedMaterial({ sway: { start: 150, height: 260, amp: 5 }, rim: 0.8 });
  const farMat: MeshLambertMaterial = createPaintedMaterial({ rim: 0.8 });

  // Group tree indices by (kind, chunk).
  const groups = new Map<string, { kind: TreeKind; cx: number; cy: number; items: number[] }>();
  const kinds = Object.fromEntries(TREE_KINDS.map((k) => [k, 0])) as Record<TreeKind, number>;
  trees.forEach(([x, y, , , typeIdx], i) => {
    const style = treeTypes[typeIdx]?.style ?? 'other';
    const kind = treeKindFor(style, isBlight(x, y));
    kinds[kind]++;
    const cx = Math.floor((x - terrain.originX) / chunk);
    const cy = Math.floor((y - terrain.originY) / chunk);
    const key = `${kind}:${cx}:${cy}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind, cx, cy, items: [] };
      groups.set(key, g);
    }
    g.items.push(i);
  });

  const buckets: Bucket[] = [];
  const where = new Int32Array(trees.length * 2); // bucket index, instance index
  const dummy = new Object3D();
  const color = new Color();
  const p = new Vector3();
  for (const g of groups.values()) {
    const geos = treeGeometries(g.kind);
    const n = g.items.length;
    const near = new InstancedMesh(geos.near, nearMat, n);
    const far = new InstancedMesh(geos.far, farMat, n);
    const tints = TINTS[g.kind];
    const bi = buckets.length;
    g.items.forEach((ti, k) => {
      const [x, y, , scale, , variation] = trees[ti]!;
      const h = (s: number): number => hash1(ti * 7 + s, 911);
      toThree(x, y, heightAt(x, y) - 6, p);
      dummy.position.copy(p);
      dummy.rotation.set((h(1) - 0.5) * 0.08, h(2) * Math.PI * 2, (h(3) - 0.5) * 0.08);
      const s = (scale > 0 ? scale : 1) * (0.9 + h(4) * 0.2);
      dummy.scale.set(s, s * (0.9 + h(5) * 0.25), s);
      dummy.updateMatrix();
      near.setMatrixAt(k, dummy.matrix);
      far.setMatrixAt(k, dummy.matrix);
      color.setHex(tints[(variation + Math.floor(h(6) * 7)) % tints.length]!);
      color.multiplyScalar(0.84 + h(7) * 0.26);
      near.setColorAt(k, color);
      far.setColorAt(k, color);
      where[ti * 2] = bi;
      where[ti * 2 + 1] = k;
    });
    near.instanceMatrix.needsUpdate = true;
    far.instanceMatrix.needsUpdate = true;
    near.computeBoundingSphere();
    far.computeBoundingSphere();
    near.castShadow = true;
    near.receiveShadow = true;
    far.visible = false;
    near.name = `trees_${g.kind}_${g.cx}_${g.cy}`;
    far.name = `${near.name}_far`;
    group.add(near, far);
    // Chunk AABB in three.js xz (z = −y).
    const x0 = terrain.originX + g.cx * chunk;
    const y0 = terrain.originY + g.cy * chunk;
    buckets.push({
      kind: g.kind,
      near,
      far,
      minX: x0 - 200,
      maxX: x0 + chunk + 200,
      minZ: -(y0 + chunk) - 200,
      maxZ: -y0 + 200,
      matrices: new Float32Array(near.instanceMatrix.array),
    });
  }

  const zero = new Matrix4().makeScale(0, 0, 0);
  const tmp = new Matrix4();

  return {
    group,
    count: trees.length,
    kinds,
    update: (cam) => {
      for (const b of buckets) {
        const dx = Math.max(b.minX - cam.x, 0, cam.x - b.maxX);
        const dz = Math.max(b.minZ - cam.z, 0, cam.z - b.maxZ);
        const near = dx * dx + dz * dz < TREE_NEAR_DISTANCE * TREE_NEAR_DISTANCE;
        b.near.visible = near;
        b.far.visible = !near;
      }
    },
    setTreeVisible: (index, visible) => {
      if (index < 0 || index >= trees.length) return;
      const b = buckets[where[index * 2]!];
      if (!b) return;
      const k = where[index * 2 + 1]!;
      const m = visible ? tmp.fromArray(b.matrices, k * 16) : zero;
      b.near.setMatrixAt(k, m);
      b.far.setMatrixAt(k, m);
      b.near.instanceMatrix.needsUpdate = true;
      b.far.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      for (const b of buckets) {
        b.near.dispose();
        b.far.dispose();
      }
      nearMat.dispose();
      farMat.dispose();
    },
  };
};
