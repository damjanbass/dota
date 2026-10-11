// Decorative doodads (rocks, shrubs, ferns, mushrooms, bones, crystals, ruins): one global
// InstancedMesh per kind. WC3 doodad ids are mapped by their category letter + suffix; unknown
// custom ids (D00x), water and structure doodads are skipped rather than guessed.
import { Color, Group, InstancedMesh, Object3D } from 'three';
import type { BufferGeometry } from 'three';
import { toThree } from '../core/coords';
import type { LoadedMap } from '../core/map';
import { ModelBuilder, boxB, coneB, cylB, dodeca, horn, ico, octa, sphere } from './geom';
import { createPaintedMaterial } from './materials';
import { hash1, hashString } from './noise';

export type DoodadKind = 'rock' | 'bush' | 'fern' | 'mushroom' | 'bones' | 'crystal' | 'ruin';

export const DOODAD_KINDS: readonly DoodadKind[] = ['rock', 'bush', 'fern', 'mushroom', 'bones', 'crystal', 'ruin'];

/** Maps a WC3 doodad type id to a doodad look, or null to skip it. Pure. */
export const doodadKindFor = (typeId: string): DoodadKind | null => {
  if (typeId.length !== 4 || /^D\d/.test(typeId)) return null;
  const cat = typeId.charAt(1).toUpperCase();
  const rest = typeId.slice(2).toLowerCase();
  switch (cat) {
    case 'R':
      return 'rock';
    case 'P':
      if (rest === 'ms') return 'mushroom';
      if (rest === 'lp' || rest === 'lw' || rest === 'tv') return null;
      if (rest === 'fw' || rest === 'fe' || rest === 'fn' || rest === 'ct') return 'fern';
      return 'bush';
    case 'O':
      if (rest === 'sk' || rest === 'bn' || rest === 'bo' || rest === 'bz') return 'bones';
      if (rest === 'ic' || rest === 'cr') return 'crystal';
      if (rest === 'th' || rest === 'nt' || rest === 'sh') return 'bush';
      if (rest === 'st' || rest === 'ob' || rest === 'al' || rest === 'gr' || rest === 'tb' || rest === 'ks' || rest === 'gs') return 'ruin';
      if (rest === 'sr' || rest === 'rk' || rest === 'bt' || rest === 'bd' || rest === 'tz') return 'rock';
      return null;
    default:
      return null;
  }
};

const geoCache = new Map<DoodadKind, BufferGeometry>();

const buildGeo = (kind: DoodadKind): BufferGeometry => {
  const b = new ModelBuilder();
  switch (kind) {
    case 'rock':
      b.add(dodeca(38), { p: [0, 14, 0], s: [1.2, 0.75, 1] }, { color: 0x7e786c, jitter: 7, grad: 0.4, seed: 1 });
      b.add(dodeca(20), { p: [34, 6, 18], s: [1, 0.7, 1] }, { color: 0x8a8476, jitter: 4, seed: 2 });
      break;
    case 'bush':
      b.add(ico(17, 1), { p: [0, 12, 0], s: [1.2, 0.8, 1.1] }, { color: 0x4f9a40, jitter: 3, grad: 0.55, seed: 3 });
      b.add(ico(12, 0), { p: [14, 9, -8] }, { color: 0x5aa848, jitter: 2, grad: 0.5, seed: 4 });
      b.add(ico(11, 0), { p: [-12, 8, 9] }, { color: 0x468a3a, jitter: 2, grad: 0.5, seed: 5 });
      break;
    case 'fern':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.add(horn([Math.cos(a) * 46, 22, Math.sin(a) * 46], [Math.cos(a) * 14, 34, Math.sin(a) * 14], 6, 1, 3, 3), undefined, { color: 0x4a9040, grad: 0.4, seed: 10 + i });
      }
      break;
    case 'mushroom':
      b.add(cylB(4, 6, 26, 6), undefined, { color: 0xe0d8c0 });
      b.add(sphere(16, 8, 4), { p: [0, 26, 0], s: [1, 0.55, 1] }, { color: 0x8a4ab0, emissive: 0.35 });
      b.add(cylB(3, 4, 16, 5), { p: [18, 0, 8] }, { color: 0xe0d8c0 });
      b.add(sphere(9, 7, 4), { p: [18, 16, 8], s: [1, 0.55, 1] }, { color: 0x6a8ad0, emissive: 0.35 });
      break;
    case 'bones':
      b.add(sphere(9, 6, 5), { p: [0, 7, 0] }, { color: 0xd8ccac });
      b.add(horn([30, 4, 6], [15, 6, 0], 3, 2, 2, 4), { p: [6, 3, 6] }, { color: 0xd0c4a4 });
      b.add(horn([-22, 4, 20], [-10, 6, 8], 3, 2, 2, 4), { p: [0, 3, -6] }, { color: 0xc8bc9c });
      break;
    case 'crystal':
      b.add(octa(18), { p: [0, 30, 0], s: [0.8, 2, 0.8] }, { color: 0x9ad8ff, emissive: 0.6 });
      b.add(octa(10), { p: [16, 16, 8], s: [0.8, 1.8, 0.8], r: [0.3, 0, -0.3] }, { color: 0xb8e8ff, emissive: 0.6 });
      break;
    case 'ruin':
      b.add(boxB(44, 14, 44), undefined, { color: 0x6a6a6e, jitter: 2 });
      b.add(cylB(14, 16, 90, 6), { p: [0, 14, 0] }, { color: 0x8a8a90, jitter: 2, grad: 0.4 });
      b.add(boxB(36, 10, 36), { p: [0, 104, 0], r: [0.08, 0.3, 0.05] }, { color: 0x7a7a80, jitter: 2 });
      b.add(coneB(10, 20, 5), { p: [-24, 0, 18] }, { color: 0x3c6a36, jitter: 3 });
      break;
  }
  return b.build();
};

export interface Doodads {
  group: Group;
  counts: Record<DoodadKind, number>;
  dispose(): void;
}

export const createDoodads = (
  map: LoadedMap,
  heightAt: (x: number, y: number) => number,
  isBlight: (x: number, y: number) => boolean,
): Doodads => {
  const group = new Group();
  group.name = 'doodads';
  const byKind = new Map<DoodadKind, number[]>();
  map.data.doodads.forEach((d, i) => {
    const k = doodadKindFor(d.typeId);
    if (!k) return;
    let list = byKind.get(k);
    if (!list) byKind.set(k, (list = []));
    list.push(i);
  });
  const material = createPaintedMaterial({ rim: 0.7 });
  const counts = Object.fromEntries(DOODAD_KINDS.map((k) => [k, 0])) as Record<DoodadKind, number>;
  const meshes: InstancedMesh[] = [];
  const dummy = new Object3D();
  const color = new Color();
  for (const [kind, list] of byKind) {
    let geo = geoCache.get(kind);
    if (!geo) geoCache.set(kind, (geo = buildGeo(kind)));
    const mesh = new InstancedMesh(geo, material, list.length);
    list.forEach((di, k) => {
      const d = map.data.doodads[di]!;
      const h = hash1(di * 13 + hashString(d.typeId), 77);
      toThree(d.x, d.y, heightAt(d.x, d.y) - 2, dummy.position);
      dummy.rotation.set(0, d.facing + h * 0.6, 0);
      const s = (d.scale > 0 ? d.scale : 1) * (0.85 + h * 0.3);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      const blighted = isBlight(d.x, d.y) && (kind === 'bush' || kind === 'fern');
      color.setRGB(1, 1, 1).multiplyScalar(0.85 + h * 0.3);
      if (blighted) color.multiply(new Color(0.75, 0.55, 0.85));
      mesh.setColorAt(k, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = kind === 'rock' || kind === 'ruin';
    mesh.receiveShadow = true;
    mesh.name = `doodads_${kind}`;
    counts[kind] = list.length;
    meshes.push(mesh);
    group.add(mesh);
  }
  return {
    group,
    counts,
    dispose: () => {
      meshes.forEach((m) => m.dispose());
      material.dispose();
    },
  };
};

export const disposeDoodadCache = (): void => {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
};
