// Time of day: sun/moon directional light (camera-following shadows), hemisphere ambient,
// distance fog and sky colours. WC3 convention: day 06:00–18:00; night is deep blue, darker,
// with shorter visibility.
import { Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from 'three';
import { toThree } from '../core/coords';
import { worldUniforms } from './materials';
import type { Sky } from './sky';

interface Palette {
  hour: number;
  zenith: number;
  horizon: number;
  ground: number;
  fog: number;
  light: number;
  lightI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  rim: number;
  rimI: number;
  cloud: number;
  fogNear: number;
  fogFar: number;
  /** 0 = sun drives the directional light, 1 = moon. */
  night: number;
}

// Keyframes over a 24 h clock (hour 24 wraps to 0).
const KEYS: Palette[] = [
  { hour: 0, zenith: 0x050c2a, horizon: 0x1c2c62, ground: 0x0a0e20, fog: 0x18265a, light: 0x86a2ff, lightI: 1.15, hemiSky: 0x3a58a8, hemiGround: 0x101632, hemiI: 1.25, rim: 0x4a6ae0, rimI: 0.55, cloud: 0x2a3660, fogNear: 500, fogFar: 5200, night: 1 },
  { hour: 4.6, zenith: 0x081034, horizon: 0x24346c, ground: 0x0c1022, fog: 0x1c2a5e, light: 0x86a2ff, lightI: 1.1, hemiSky: 0x3a58a8, hemiGround: 0x101632, hemiI: 1.2, rim: 0x4a6ae0, rimI: 0.5, cloud: 0x2e3a66, fogNear: 600, fogFar: 5600, night: 1 },
  { hour: 6, zenith: 0x3d5ea8, horizon: 0xf2a878, ground: 0x3a3040, fog: 0xc29a8c, light: 0xffb27a, lightI: 1.5, hemiSky: 0x8ea0d8, hemiGround: 0x403028, hemiI: 1.25, rim: 0xffa070, rimI: 0.45, cloud: 0xffc0a0, fogNear: 1400, fogFar: 9000, night: 0 },
  { hour: 7.5, zenith: 0x4a86d6, horizon: 0xc0dcf4, ground: 0x506070, fog: 0xbcd4ea, light: 0xfff0d6, lightI: 2.6, hemiSky: 0xc4dcff, hemiGround: 0x5c5444, hemiI: 1.55, rim: 0xa8c4ff, rimI: 0.35, cloud: 0xffffff, fogNear: 2600, fogFar: 12500, night: 0 },
  { hour: 12, zenith: 0x3a7ad6, horizon: 0xc8e0f6, ground: 0x506070, fog: 0xc0d8ee, light: 0xfff8e8, lightI: 2.9, hemiSky: 0xc8dcff, hemiGround: 0x5e5848, hemiI: 1.6, rim: 0xb0c8ff, rimI: 0.3, cloud: 0xffffff, fogNear: 3000, fogFar: 13500, night: 0 },
  { hour: 16.5, zenith: 0x4878c4, horizon: 0xecd4b4, ground: 0x585060, fog: 0xdcccb4, light: 0xffe2b4, lightI: 2.5, hemiSky: 0xc0cce8, hemiGround: 0x5c4c3c, hemiI: 1.5, rim: 0xffd0a0, rimI: 0.35, cloud: 0xfff0e0, fogNear: 2600, fogFar: 12000, night: 0 },
  { hour: 18, zenith: 0x34428a, horizon: 0xf08a5c, ground: 0x3a2a3a, fog: 0xbc7a6c, light: 0xff9454, lightI: 1.5, hemiSky: 0x8a7ab4, hemiGround: 0x3a2a2a, hemiI: 1.25, rim: 0xff8a58, rimI: 0.5, cloud: 0xffa080, fogNear: 1400, fogFar: 9000, night: 0 },
  { hour: 19.4, zenith: 0x0e1846, horizon: 0x40387a, ground: 0x0e0e24, fog: 0x262a62, light: 0x8aa2ff, lightI: 1.05, hemiSky: 0x40549a, hemiGround: 0x121430, hemiI: 1.2, rim: 0x5a6ad8, rimI: 0.5, cloud: 0x3a3a70, fogNear: 600, fogFar: 5600, night: 1 },
];

const _a = new Color();
const _b = new Color();
const mixHex = (out: Color, h1: number, h2: number, t: number): Color => out.copy(_a.setHex(h1)).lerp(_b.setHex(h2), t);

/** Interpolated palette for an hour in [0, 24). Pure. */
export const paletteAt = (hour: number): { a: Palette; b: Palette; t: number } => {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYS.length; i++) {
    const a = KEYS[i]!;
    const b = KEYS[(i + 1) % KEYS.length]!;
    const bh = b.hour <= a.hour ? b.hour + 24 : b.hour;
    if (h >= a.hour && h < bh) return { a, b, t: (h - a.hour) / (bh - a.hour) };
  }
  const last = KEYS[KEYS.length - 1]!;
  const first = KEYS[0]!;
  return { a: last, b: first, t: (h - last.hour) / (24 - last.hour) };
};

/** WC3 sun direction (unit vector toward the sun) for an hour; null when below the horizon. */
export const sunDirectionWc3 = (hour: number): Vector3 | null => {
  if (hour < 5.6 || hour > 18.4) return null;
  const a = ((hour - 6) / 12) * Math.PI;
  const elev = Math.max(0.16, Math.sin(Math.min(Math.PI, Math.max(0, a))));
  return new Vector3(Math.cos(a), -0.45, elev * 1.05).normalize();
};

const MOON_WC3 = new Vector3(-0.45, 0.55, 0.85).normalize();
const UP = new Vector3(0, 1, 0);

export interface DayNight {
  root: Group;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fog: Fog;
  readonly timeOfDay: number;
  setTimeOfDay(t01: number): void;
  /** Recentres the shadow frustum near the camera (three.js world space). */
  update(cameraPos: Vector3): void;
  dispose(): void;
}

export interface DayNightOptions {
  shadowSize?: number;
  shadowMapSize?: number;
}

export const createDayNight = (sky: Sky, opts: DayNightOptions = {}): DayNight => {
  const root = new Group();
  root.name = 'daynight';
  const sun = new DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  const half = opts.shadowSize ?? 1700;
  const mapSize = opts.shadowMapSize ?? 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 50;
  cam.far = 12000;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 2.5;
  root.add(sun, sun.target);

  const hemi = new HemisphereLight(0xc8dcff, 0x5e5848, 1.5);
  root.add(hemi);
  const fog = new Fog(0xc0d8ee, 3000, 13000);

  const lightDir = new Vector3(0.5, 0.7, -0.4).normalize();
  let tod = 0.4;
  const tmpC = new Color();

  const setTimeOfDay = (t01: number): void => {
    tod = ((t01 % 1) + 1) % 1;
    const hour = tod * 24;
    const { a, b, t } = paletteAt(hour);
    const lerp = (x: number, y: number): number => x + (y - x) * t;
    const night = lerp(a.night, b.night);

    const sunW = sunDirectionWc3(hour);
    const dirW = sunW && night < 0.5 ? sunW : MOON_WC3;
    toThree(dirW.x, dirW.y, dirW.z, lightDir).normalize();
    worldUniforms.uLightDir.value.copy(lightDir);

    mixHex(sun.color, a.light, b.light, t);
    sun.intensity = lerp(a.lightI, b.lightI);
    sun.shadow.intensity = night > 0.5 ? 0.6 : 0.85;
    worldUniforms.uLightColor.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);

    mixHex(hemi.color, a.hemiSky, b.hemiSky, t);
    mixHex(hemi.groundColor, a.hemiGround, b.hemiGround, t);
    hemi.intensity = lerp(a.hemiI, b.hemiI);
    worldUniforms.uAmbient.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI);

    mixHex(fog.color, a.fog, b.fog, t);
    fog.near = lerp(a.fogNear, b.fogNear);
    fog.far = lerp(a.fogFar, b.fogFar);

    mixHex(tmpC, a.rim, b.rim, t);
    worldUniforms.uRimColor.value.copy(tmpC).multiplyScalar(lerp(a.rimI, b.rimI));

    const u = sky.uniforms;
    mixHex(u.uZenith.value, a.zenith, b.zenith, t);
    mixHex(u.uHorizon.value, a.horizon, b.horizon, t);
    mixHex(u.uGround.value, a.ground, b.ground, t);
    mixHex(u.uCloudColor.value, a.cloud, b.cloud, t);
    // Horizon must equal fog colour so distant terrain melts into the sky.
    u.uHorizon.value.lerp(fog.color, 0.6);
    worldUniforms.uSkyColor.value.copy(u.uZenith.value);
    worldUniforms.uHorizonColor.value.copy(u.uHorizon.value);
    const sunDir = sunDirectionWc3(hour);
    if (sunDir) toThree(sunDir.x, sunDir.y, sunDir.z, u.uSunDir.value).normalize();
    u.uSunVis.value = sunDir ? 1 - night : 0;
    mixHex(u.uSunColor.value, a.light, b.light, t);
    toThree(MOON_WC3.x, MOON_WC3.y, MOON_WC3.z, u.uMoonDir.value).normalize();
    u.uNight.value = night;
  };

  // Shadow frustum follows the camera, snapped to shadow texels to avoid shimmering.
  const right = new Vector3();
  const up = new Vector3();
  const center = new Vector3();
  const update = (cameraPos: Vector3): void => {
    const texel = (half * 2) / mapSize;
    right.crossVectors(lightDir, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, lightDir).normalize();
    center.copy(cameraPos);
    const rx = center.dot(right);
    const uy = center.dot(up);
    center.addScaledVector(right, Math.round(rx / texel) * texel - rx);
    center.addScaledVector(up, Math.round(uy / texel) * texel - uy);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(lightDir, 6000);
    sun.target.updateMatrixWorld();
  };

  setTimeOfDay(tod);

  return {
    root,
    sun,
    hemi,
    fog,
    get timeOfDay() {
      return tod;
    },
    setTimeOfDay,
    update,
    dispose: () => {
      sun.dispose();
      sun.shadow.map?.dispose();
      hemi.dispose();
    },
  };
};
