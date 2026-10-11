// Ground-hugging annulus / disc: a polar grid whose vertices follow the terrain heightfield, for AoE rings that sit
// on slopes instead of clipping into them. Render-only; positions in three.js space.
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { Material } from 'three';
import { groundHeightAt } from '../../../core/map';
import type { LoadedMap } from '../../../core/map';

export class DrapedAnnulus {
  readonly mesh: Mesh;
  private readonly geometry: BufferGeometry;
  private readonly positions: Float32Array;
  private readonly segments: number;
  private readonly rings: number;

  /** `rings` = radial subdivisions (1 for a thin ribbon, more for a disc that drapes well). */
  constructor(material: Material, segments = 96, rings = 1) {
    this.segments = segments;
    this.rings = rings;
    const cols = segments + 1;
    const n = cols * (rings + 1);
    this.positions = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r <= rings; r++) {
      for (let s = 0; s <= segments; s++) {
        const i = r * cols + s;
        uv[i * 2] = s / segments;
        uv[i * 2 + 1] = r / rings;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = r * cols + s;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Places the annulus (WC3 centre, inner / outer radius) on the terrain, `lift` units above it. */
  set(map: LoadedMap, x: number, y: number, inner: number, outer: number, lift = 5): void {
    const cols = this.segments + 1;
    for (let r = 0; r <= this.rings; r++) {
      const rad = inner + ((outer - inner) * r) / this.rings;
      for (let s = 0; s <= this.segments; s++) {
        const a = (s / this.segments) * Math.PI * 2;
        const wx = x + Math.cos(a) * rad;
        const wy = y + Math.sin(a) * rad;
        // three = (x, z, -y), see core/coords.ts.
        const j = (r * cols + s) * 3;
        this.positions[j] = wx;
        this.positions[j + 1] = groundHeightAt(map, wx, wy) + lift;
        this.positions[j + 2] = -wy;
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
