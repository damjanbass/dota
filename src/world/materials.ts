// Shared "hand-painted" material: Lambert + vertex colours + per-vertex emissive + soft rim light.
// One material instance per variant keeps program count and draw-state changes low.
import { Color, DoubleSide, MeshLambertMaterial, Vector3 } from 'three';
import type { IUniform, WebGLProgramParametersWithUniforms } from 'three';

/** Uniforms shared by every world material; daynight.ts and index.ts drive them. */
export const worldUniforms = {
  uTime: { value: 0 } as IUniform<number>,
  /** Rim light colour (already scaled by intensity). */
  uRimColor: { value: new Color(0.22, 0.26, 0.38) } as IUniform<Color>,
  /** Wind strength multiplier for foliage sway. */
  uWind: { value: 1 } as IUniform<number>,
  /** Direction toward the sun/moon (three.js world space, normalised). */
  uLightDir: { value: new Vector3(0.5, 0.7, -0.5).normalize() } as IUniform<Vector3>,
  /** Sun/moon colour × intensity (linear). */
  uLightColor: { value: new Color(1, 1, 1) } as IUniform<Color>,
  /** Sky zenith / horizon colours (linear) for reflections. */
  uSkyColor: { value: new Color(0.3, 0.5, 0.9) } as IUniform<Color>,
  uHorizonColor: { value: new Color(0.7, 0.8, 0.9) } as IUniform<Color>,
  /** Ambient (hemisphere sky colour × intensity). */
  uAmbient: { value: new Color(0.4, 0.45, 0.5) } as IUniform<Color>,
};

export interface PaintedOptions {
  /** Foliage sway for instanced trees (vertices above `swayStart` move). */
  sway?: { start: number; height: number; amp: number };
  doubleSide?: boolean;
  flatShading?: boolean;
  /** Rim strength multiplier. */
  rim?: number;
}

const SWAY_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 swayOrigin = instanceMatrix[3].xyz;
#else
  vec3 swayOrigin = vec3(0.0);
#endif
  float swayW = max(position.y - uSwayStart, 0.0) / uSwayHeight;
  swayW *= swayW;
  float swayPh = swayOrigin.x * 0.0021 + swayOrigin.z * 0.0017;
  transformed.x += sin(uTime * 1.3 + swayPh) * uSwayAmp * swayW * uWind;
  transformed.z += sin(uTime * 0.9 + swayPh * 1.7 + 1.3) * uSwayAmp * 0.7 * swayW * uWind;
`;

const patchPainted = (shader: WebGLProgramParametersWithUniforms, opts: PaintedOptions): void => {
  shader.uniforms.uTime = worldUniforms.uTime;
  shader.uniforms.uRimColor = worldUniforms.uRimColor;
  shader.uniforms.uWind = worldUniforms.uWind;
  shader.uniforms.uRimStrength = { value: opts.rim ?? 1 };
  const sway = opts.sway;
  shader.uniforms.uSwayStart = { value: sway?.start ?? 0 };
  shader.uniforms.uSwayHeight = { value: sway?.height ?? 1 };
  shader.uniforms.uSwayAmp = { value: sway?.amp ?? 0 };

  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float aEmissive;
varying float vEmissive;
uniform float uTime;
uniform float uWind;
uniform float uSwayStart;
uniform float uSwayHeight;
uniform float uSwayAmp;`,
    )
    .replace('#include <color_vertex>', '#include <color_vertex>\n  vEmissive = aEmissive;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway ? SWAY_VERTEX : ''}`);

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vEmissive;
uniform vec3 uRimColor;
uniform float uRimStrength;`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * vEmissive * 1.6;
  float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += uRimColor * uRimStrength * pow(rimF, 2.6) * (0.35 + 0.65 * diffuseColor.rgb);`,
    );
};

/** Creates a painted material. Geometry needs `color` (vec3) and `aEmissive` (float) attributes. */
export const createPaintedMaterial = (opts: PaintedOptions = {}): MeshLambertMaterial => {
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    side: opts.doubleSide ? DoubleSide : undefined,
    flatShading: opts.flatShading ?? false,
  });
  mat.onBeforeCompile = (shader) => patchPainted(shader, opts);
  // Distinct cache keys so variants compile separately.
  mat.customProgramCacheKey = () => `painted:${opts.sway ? 'sway' : ''}:${opts.rim ?? 1}`;
  return mat;
};

let sharedPainted: MeshLambertMaterial | null = null;

/** Shared material for buildings, units and doodads (one program for all). */
export const getPaintedMaterial = (): MeshLambertMaterial => (sharedPainted ??= createPaintedMaterial());

export const disposeSharedMaterials = (): void => {
  sharedPainted?.dispose();
  sharedPainted = null;
};
