// River / lake surface where map water ≠ NaN: shallow teal transparency, animated normals,
// sun glint, sky fresnel and a foamy shoreline fade (depth = water Z − visual ground Z).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { worldUniforms } from './materials';
import { fbm } from './noise';
import type { TerrainGrid } from './terrainGrid';

export interface Water {
  mesh: Mesh | null;
  dispose(): void;
}

const VERT = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNormalMap;
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uAmbient;
uniform vec3 uShallow;
uniform vec3 uDeep;
varying float vDepth;
varying vec3 vWPos;
#include <fog_pars_fragment>

void main() {
  vec2 uv = vWPos.xz / 560.0;
  vec4 s1 = texture(uNormalMap, uv + vec2(uTime * 0.017, uTime * 0.011));
  vec4 s2 = texture(uNormalMap, uv * 1.73 - vec2(uTime * 0.012, -uTime * 0.019));
  vec2 nxy = (s1.xy * 2.0 - 1.0) + (s2.xy * 2.0 - 1.0);
  vec3 n = normalize(vec3(nxy.x, 2.4, nxy.y));
  vec3 V = normalize(cameraPosition - vWPos);
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  float depthK = smoothstep(0.0, 95.0, vDepth);
  vec3 base = mix(uShallow, uDeep, depthK);
  float ndl = max(dot(n, uLightDir), 0.0);
  vec3 lit = base * (uAmbient * 1.9 + uLightColor * (0.55 + 0.45 * ndl));
  vec3 refl = mix(uHorizonColor, uSkyColor, 0.3);
  vec3 col = mix(lit, refl, fres * 0.65 + 0.06);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(n, H), 0.0), 160.0);
  col += uLightColor * spec * 2.2;

  float foamN = texture(uNormalMap, uv * 3.1 + vec2(uTime * 0.021, 0.0)).w;
  float edge = 1.0 - smoothstep(0.0, 16.0, vDepth);
  float foam = edge * smoothstep(0.38, 0.72, foamN + 0.22 * sin(uTime * 1.6 + vWPos.x * 0.021 + vWPos.z * 0.017));
  col = mix(col, vec3(0.92, 0.98, 1.0) * (uAmbient * 2.2 + uLightColor * 0.7), foam * 0.7);

  float alpha = mix(0.42, 0.86, depthK) * smoothstep(-1.0, 9.0, vDepth);
  alpha = max(alpha, foam * 0.7 * smoothstep(-2.0, 3.0, vDepth));
  alpha = max(alpha, fres * 0.5 * smoothstep(-1.0, 6.0, vDepth));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

let normalTex: DataTexture | null = null;

/** Tileable water normal map (xy = slope, z = up, w = foam noise). */
const waterNormalMap = (): DataTexture => {
  if (normalTex) return normalTex;
  const N = 256;
  const P = 4;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * P;
      const v = (y / N) * P;
      h[y * N + x] = fbm(u, v, 5, 77, P) + 0.5 * fbm(u * 2 + 0.3, v * 2 - 0.7, 3, 91, P * 2);
    }
  }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hx = h[y * N + ((x + 1) % N)]! - h[y * N + ((x + N - 1) % N)]!;
      const hy = h[((y + 1) % N) * N + x]! - h[((y + N - 1) % N) * N + x]!;
      const s = 6;
      const nx = -hx * s;
      const ny = -hy * s;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      d[o] = (nx / len) * 127.5 + 127.5;
      d[o + 1] = (ny / len) * 127.5 + 127.5;
      d[o + 2] = (1 / len) * 127.5 + 127.5;
      d[o + 3] = fbm((x / N) * 8, (y / N) * 8, 3, 133, 8) * 255;
    }
  }
  const t = new DataTexture(d, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  normalTex = t;
  return t;
};

export const createWater = (grid: TerrainGrid): Water => {
  const { cols, rows, step, originX, originY } = grid;
  const vertIndex = new Int32Array(cols * rows).fill(-1);
  const pos: number[] = [];
  const depth: number[] = [];
  const idx: number[] = [];
  const vert = (g: number): number => {
    let v = vertIndex[g]!;
    if (v >= 0) return v;
    v = pos.length / 3;
    const gx = g % cols;
    const gy = (g - gx) / cols;
    const wz = grid.waterZ[g]!;
    // WC3 → three: (x, z, -y). Lattice (undisplaced) positions.
    pos.push(originX + gx * step, wz, -(originY + gy * step));
    depth.push(wz - grid.pz[g]!);
    vertIndex[g] = v;
    return v;
  };
  for (let gy = 0; gy < rows - 1; gy++) {
    for (let gx = 0; gx < cols - 1; gx++) {
      const a = gy * cols + gx;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      const wa = grid.waterZ[a]!;
      const wb = grid.waterZ[b]!;
      const wc = grid.waterZ[c]!;
      const wd = grid.waterZ[d]!;
      if (Number.isNaN(wa) || Number.isNaN(wb) || Number.isNaN(wc) || Number.isNaN(wd)) continue;
      const maxDepth = Math.max(wa - grid.pz[a]!, wb - grid.pz[b]!, wc - grid.pz[c]!, wd - grid.pz[d]!);
      if (maxDepth < -24) continue;
      const va = vert(a);
      const vb = vert(b);
      const vc = vert(c);
      const vd = vert(d);
      idx.push(va, vb, vd, va, vd, vc);
    }
  }
  if (idx.length === 0) return { mesh: null, dispose: () => {} };

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aDepth', new BufferAttribute(new Float32Array(depth), 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      uNormalMap: { value: waterNormalMap() },
      uTime: worldUniforms.uTime,
      uLightDir: worldUniforms.uLightDir,
      uLightColor: worldUniforms.uLightColor,
      uSkyColor: worldUniforms.uSkyColor,
      uHorizonColor: worldUniforms.uHorizonColor,
      uAmbient: worldUniforms.uAmbient,
      uShallow: { value: new Color(0x2ab0a2) },
      uDeep: { value: new Color(0x0f5a6e) },
      fogColor: { value: new Color() },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
      fogDensity: { value: 0.00025 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new Mesh(geo, material);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
};
