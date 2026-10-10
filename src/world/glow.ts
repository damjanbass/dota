// Additive glow billboards (orbs, moonwells, wisps). One draw call per glow set; the quads face
// the camera in the vertex shader and are pushed toward it so they don't clip into their source.
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { V3 } from './geom';
import { worldUniforms } from './materials';

export interface GlowSpec {
  /** Local position (model space, three.js axes). */
  p: V3;
  /** World size (diameter) of the halo. */
  size: number;
  color: number;
  /** 0..1+ brightness. */
  intensity?: number;
}

const VERT = /* glsl */ `
attribute vec4 aGlow;
attribute vec4 aGlowColor;
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(aGlow.xyz, 1.0);
  float pulse = 1.0 + 0.07 * sin(uTime * 2.1 + aGlow.x * 0.05 + aGlow.y * 0.03);
  float size = aGlow.w * pulse;
  mvPosition.xy += position.xy * size;
  mvPosition.z += size * 0.45;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vColor = aGlowColor;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.2) + 0.5 * pow(max(1.0 - d, 0.0), 8.0);
  vec3 col = vColor.rgb * a * vColor.a;
  #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

let sharedMat: ShaderMaterial | null = null;
let quad: PlaneGeometry | null = null;

const glowMaterial = (): ShaderMaterial =>
  (sharedMat ??= new ShaderMaterial({
    uniforms: {
      uTime: worldUniforms.uTime,
      fogColor: { value: new Color() },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
      fogDensity: { value: 0.00025 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  }));

/** Builds one mesh drawing all `glows` (model space). Returns null for an empty list. */
export const createGlowMesh = (glows: readonly GlowSpec[]): Mesh | null => {
  if (glows.length === 0) return null;
  quad ??= new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const pos = new Float32Array(glows.length * 4);
  const col = new Float32Array(glows.length * 4);
  const c = new Color();
  glows.forEach((g, i) => {
    pos.set([g.p[0], g.p[1], g.p[2], g.size], i * 4);
    c.setHex(g.color);
    col.set([c.r, c.g, c.b, g.intensity ?? 1], i * 4);
  });
  geo.setAttribute('aGlow', new InstancedBufferAttribute(pos, 4));
  geo.setAttribute('aGlowColor', new InstancedBufferAttribute(col, 4));
  geo.instanceCount = glows.length;
  // Bounding sphere around all glow centres (+ size) for frustum culling.
  let maxR = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const g of glows) {
    cx += g.p[0] / glows.length;
    cy += g.p[1] / glows.length;
    cz += g.p[2] / glows.length;
  }
  for (const g of glows) maxR = Math.max(maxR, Math.hypot(g.p[0] - cx, g.p[1] - cy, g.p[2] - cz) + g.size);
  geo.computeBoundingSphere();
  geo.boundingSphere!.center.set(cx, cy, cz);
  geo.boundingSphere!.radius = maxR;
  const mesh = new Mesh(geo as BufferGeometry, glowMaterial());
  mesh.name = 'glow';
  mesh.renderOrder = 5;
  return mesh;
};

export const disposeGlowShared = (): void => {
  sharedMat?.dispose();
  sharedMat = null;
  quad?.dispose();
  quad = null;
};
