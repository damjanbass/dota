// Sky dome: gradient + sun/moon + stars + soft painted clouds. Always drawn behind everything
// (depth pinned to the far plane) and recentred on the camera each frame.
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { worldUniforms } from './materials';

export interface Sky {
  mesh: Mesh;
  uniforms: {
    uZenith: { value: Color };
    uHorizon: { value: Color };
    uGround: { value: Color };
    uSunDir: { value: Vector3 };
    uSunColor: { value: Color };
    uSunVis: { value: number };
    uMoonDir: { value: Vector3 };
    uNight: { value: number };
    uCloudColor: { value: Color };
  };
  update(cameraPos: Vector3): void;
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform vec3 uMoonDir;
uniform float uNight;
uniform vec3 uCloudColor;
uniform float uTime;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash3(vec3(i, 1.0));
  float b = hash3(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = hash3(vec3(i + vec2(0.0, 1.0), 1.0));
  float d = hash3(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += vnoise(p) * a;
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, h), 0.65));
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.9985, 0.9992, sd) * 2.5 + pow(sd, 10.0) * 0.28 + pow(sd, 3.0) * 0.06) * uSunVis;

  float md = max(dot(d, uMoonDir), 0.0);
  float moonDisk = smoothstep(0.9990, 0.9994, md);
  col = mix(col, vec3(0.85, 0.9, 1.0), moonDisk * uNight);
  col += vec3(0.35, 0.45, 0.8) * pow(md, 24.0) * 0.35 * uNight;

  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 260.0;
    vec3 cp = floor(sp);
    float r = hash3(cp);
    if (r > 0.978) {
      vec3 f = fract(sp) - 0.5;
      float s = smoothstep(0.22, 0.0, length(f));
      float tw = 0.65 + 0.35 * sin(uTime * 2.3 + r * 91.0);
      col += vec3(0.85, 0.9, 1.0) * s * tw * uNight * smoothstep(0.02, 0.3, h);
    }
  }

  if (h > -0.05) {
    vec2 cuv = d.xz / (max(h, 0.0) + 0.12) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
    float c = fbm(cuv);
    float cm = smoothstep(0.5, 0.78, c) * smoothstep(-0.02, 0.22, h);
    float lit = 0.75 + 0.25 * smoothstep(0.4, 0.9, fbm(cuv * 1.7 + 3.1));
    col = mix(col, uCloudColor * lit, cm * 0.65);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const createSky = (): Sky => {
  const uniforms = {
    uZenith: { value: new Color(0x3f7fd8) },
    uHorizon: { value: new Color(0xc4dcf4) },
    uGround: { value: new Color(0x40506a) },
    uSunDir: { value: new Vector3(0.4, 0.7, -0.5).normalize() },
    uSunColor: { value: new Color(1, 0.95, 0.85) },
    uSunVis: { value: 1 },
    uMoonDir: { value: new Vector3(-0.4, 0.75, 0.5).normalize() },
    uNight: { value: 0 },
    uCloudColor: { value: new Color(1, 1, 1) },
  };
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, uTime: worldUniforms.uTime },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const geo = new SphereGeometry(1000, 32, 16);
  const mesh = new Mesh(geo, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  return {
    mesh,
    uniforms,
    update: (cameraPos) => {
      mesh.position.copy(cameraPos);
    },
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
};
