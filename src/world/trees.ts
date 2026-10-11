// Instanced trees. Near LOD: one InstancedMesh per (16×16-tile chunk, tree kind), frustum-culled
// and shadow-casting. Far LOD: ONE InstancedMesh per kind covering the whole map; trees of chunks
// that are currently near are zero-scaled in it, so every tree is drawn exactly once.
import { Color, Group, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { toThree } from '../core/coords';
import type { LoadedMap } from '../core/map';
import { createPaintedMaterial } from './materials';
import { hash1 } from './noise';
import { TREE_KINDS, treeGeometries, treeKindFor } from './treeModels';
import type { TreeKind } from './treeModels';

/** Tiles per tree chunk edge (LOD + culling granularity). */
export const TREE_CHUNK_TILES = 16;

/** Chunks whose nearest point is closer than this (three.js units) use the detailed mesh. */
export const TREE_NEAR_DISTANCE = 2800;

interface Bucket {
  kind: TreeKind;
  near: InstancedMesh;
  far: InstancedMesh;
  /** Range of this chunk's trees inside the kind's far mesh. */
  farStart: number;
  count: number;
  /** Tree index per local instance. */
  trees: number[];
  isNear: boolean;
  /** Chunk AABB in three.js xz. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
  ashen: [0xffffff, 0xd0e4ff, 0xeaffd8, 0xd8f4ff, 0xfff4dc],
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
  const chunk = TREE_CHUNK_TILES * terrain.cellSize;
  const nearMat: MeshLambertMaterial = createPaintedMaterial({ sway: { start: 150, height: 260, amp: 5 }, rim: 0.8 });
  const farMat: MeshLambertMaterial = createPaintedMaterial({ rim: 0.8 });

  // Group tree indices by kind, then chunk.
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
    if (!g) groups.set(key, (g = { kind, cx, cy, items: [] }));
    g.items.push(i);
  });

  // Per-tree transform + tint (computed once).
  const matrices = new Float32Array(trees.length * 16);
  const colors = new Float32Array(trees.length * 3);
  const dummy = new Object3D();
  const color = new Color();
  const p = new Vector3();
  trees.forEach(([x, y, , scale, , variation], ti) => {
    const h = (s: number): number => hash1(ti * 7 + s, 911);
    toThree(x, y, heightAt(x, y) - 6, p);
    dummy.position.copy(p);
    dummy.rotation.set((h(1) - 0.5) * 0.08, h(2) * Math.PI * 2, (h(3) - 0.5) * 0.08);
    const s = (scale > 0 ? scale : 1) * (0.9 + h(4) * 0.2);
    dummy.scale.set(s, s * (0.9 + h(5) * 0.25), s);
    dummy.updateMatrix();
    dummy.matrix.toArray(matrices, ti * 16);
    const kind = treeKindFor(treeTypes[trees[ti]![4]]?.style ?? 'other', isBlight(x, y));
    const tints = TINTS[kind];
    color.setHex(tints[(variation + Math.floor(h(6) * 7)) % tints.length]!).multiplyScalar(0.84 + h(7) * 0.26);
    color.toArray(colors, ti * 3);
  });

  const farByKind = new Map<TreeKind, InstancedMesh>();
  const farFill = new Map<TreeKind, number>();
  for (const kind of TREE_KINDS) {
    if (kinds[kind] === 0) continue;
    const far = new InstancedMesh(treeGeometries(kind).far, farMat, kinds[kind]);
    far.name = `trees_${kind}_far`;
    farByKind.set(kind, far);
    farFill.set(kind, 0);
    group.add(far);
  }

  const buckets: Bucket[] = [];
  const where = new Int32Array(trees.length * 2); // bucket index, local index
  const hidden = new Uint8Array(trees.length);
  const tmp = new Matrix4();
  const zero = new Matrix4().makeScale(0, 0, 0);
  for (const g of groups.values()) {
    const n = g.items.length;
    const near = new InstancedMesh(treeGeometries(g.kind).near, nearMat, n);
    const far = farByKind.get(g.kind)!;
    const farStart = farFill.get(g.kind)!;
    farFill.set(g.kind, farStart + n);
    const bi = buckets.length;
    g.items.forEach((ti, k) => {
      tmp.fromArray(matrices, ti * 16);
      near.setMatrixAt(k, tmp);
      far.setMatrixAt(farStart + k, tmp);
      color.fromArray(colors, ti * 3);
      near.setColorAt(k, color);
      far.setColorAt(farStart + k, color);
      where[ti * 2] = bi;
      where[ti * 2 + 1] = k;
    });
    near.instanceMatrix.needsUpdate = true;
    near.computeBoundingSphere();
    near.castShadow = true;
    near.receiveShadow = true;
    near.visible = false;
    near.name = `trees_${g.kind}_${g.cx}_${g.cy}`;
    group.add(near);
    const x0 = terrain.originX + g.cx * chunk;
    const y0 = terrain.originY + g.cy * chunk;
    buckets.push({
      kind: g.kind,
      near,
      far,
      farStart,
      count: n,
      trees: g.items,
      isNear: false,
      minX: x0 - 200,
      maxX: x0 + chunk + 200,
      minZ: -(y0 + chunk) - 200,
      maxZ: -y0 + 200,
    });
  }
  for (const far of farByKind.values()) {
    far.instanceMatrix.needsUpdate = true;
    far.computeBoundingSphere();
  }

  /** Writes a bucket's far-mesh range: zero when near (drawn by the near mesh) or hidden. */
  const writeFar = (b: Bucket): void => {
    for (let k = 0; k < b.count; k++) {
      const ti = b.trees[k]!;
      b.far.setMatrixAt(b.farStart + k, b.isNear || hidden[ti] ? zero : tmp.fromArray(matrices, ti * 16));
    }
    b.far.instanceMatrix.addUpdateRange(b.farStart * 16, b.count * 16);
    b.far.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    count: trees.length,
    kinds,
    update: (cam) => {
      for (const b of buckets) {
        const dx = Math.max(b.minX - cam.x, 0, cam.x - b.maxX);
        const dz = Math.max(b.minZ - cam.z, 0, cam.z - b.maxZ);
        const near = dx * dx + dz * dz < TREE_NEAR_DISTANCE * TREE_NEAR_DISTANCE;
        if (near === b.isNear) continue;
        b.isNear = near;
        b.near.visible = near;
        writeFar(b);
      }
    },
    setTreeVisible: (index, visible) => {
      if (index < 0 || index >= trees.length) return;
      const b = buckets[where[index * 2]!];
      if (!b) return;
      hidden[index] = visible ? 0 : 1;
      const k = where[index * 2 + 1]!;
      b.near.setMatrixAt(k, visible ? tmp.fromArray(matrices, index * 16) : zero);
      b.near.instanceMatrix.needsUpdate = true;
      b.far.setMatrixAt(b.farStart + k, visible && !b.isNear ? tmp.fromArray(matrices, index * 16) : zero);
      // The far buffer is uploaded by ranges (see writeFar), so register this instance's range too.
      b.far.instanceMatrix.addUpdateRange((b.farStart + k) * 16, 16);
      b.far.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      for (const b of buckets) b.near.dispose();
      for (const f of farByKind.values()) f.dispose();
      nearMat.dispose();
      farMat.dispose();
    },
  };
};
