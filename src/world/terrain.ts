// Chunked terrain mesh with WC3-style tile splatting, blight overlay and cliff rock by slope.
// One shared material (splat shader injected into MeshLambertMaterial so shadows/fog/lights work);
// 16×16-tile chunks are frustum culled individually by three.js.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
} from 'three';
import { TileFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import { GroundLayer, groundLayersFor } from './groundTiles';
import { buildTerrainGrid, gridHeightAt } from './terrainGrid';
import type { TerrainGrid } from './terrainGrid';
import { createGroundTextures } from './terrainTextures';
import type { GroundTextures } from './terrainTextures';

/** Tiles per chunk edge. */
export const CHUNK_TILES = 16;

export interface Terrain {
  object3D: Group;
  grid: TerrainGrid;
  material: MeshLambertMaterial;
  /** Visual ground height at WC3 (x, y) — matches the rendered mesh (incl. sharpened cliffs). */
  heightAt(x: number, y: number): number;
  /** True when the nearest tilepoint is blighted. */
  isBlight(x: number, y: number): boolean;
  chunkCount: number;
  dispose(): void;
}

const NORTHERN = new Set(['N', 'W', 'I']);

const SPLAT_VERTEX_PARS = /* glsl */ `
attribute vec2 aSplat;
attribute float aAO;
attribute float aWater;
attribute float aWall;
varying vec2 vSplat;
varying float vAO;
varying float vWater;
varying float vWall;
varying vec3 vWPos;
varying vec3 vWNormal;
`;

const SPLAT_VERTEX = /* glsl */ `
  vSplat = aSplat;
  vAO = aAO;
  vWater = aWater;
  vWall = aWall;
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const SPLAT_FRAGMENT_PARS = /* glsl */ `
uniform sampler2DArray uLayers;
uniform sampler2D uTileData;
uniform sampler2D uNoise;
uniform vec2 uGridMax;
uniform float uCliffLayer;
uniform float uCliffDarkLayer;
uniform float uBlightLayer;
varying vec2 vSplat;
varying float vAO;
varying float vWater;
varying float vWall;
varying vec3 vWPos;
varying vec3 vWNormal;

vec3 layerTex(float l, vec2 uv, vec2 gx, vec2 gy) {
  return textureGrad(uLayers, vec3(uv, l), gx, gy).rgb;
}
`;

const SPLAT_FRAGMENT = /* glsl */ `
  vec2 cell = clamp(floor(vSplat), vec2(0.0), uGridMax - 1.0);
  vec2 f = clamp(vSplat - cell, 0.0, 1.0);
  ivec2 ic = ivec2(cell);
  vec4 d00 = texelFetch(uTileData, ic, 0);
  vec4 d10 = texelFetch(uTileData, ic + ivec2(1, 0), 0);
  vec4 d01 = texelFetch(uTileData, ic + ivec2(0, 1), 0);
  vec4 d11 = texelFetch(uTileData, ic + ivec2(1, 1), 0);
  vec4 nz = texture(uNoise, vSplat * 0.23);
  vec4 bil = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);

  // Irregular, painted-looking transitions between the 4 corner textures.
  vec4 w = bil + (vec4(nz.g, nz.b, 1.0 - nz.g, 1.0 - nz.b) - 0.5) * 0.75;
  w = max(w, vec4(0.0));
  w = w * w * w;
  w /= max(dot(w, vec4(1.0)), 1e-5);

  vec4 L = floor(vec4(d00.r, d10.r, d01.r, d11.r) * 255.0 + 0.5);
  vec2 uv = vSplat * 0.25;
  vec2 gdx = dFdx(uv);
  vec2 gdy = dFdy(uv);
  vec3 col;
#if TDBG == 3
  col = vec3(0.3, 0.5, 0.2);
#elif TDBG == 1
  col = layerTex(L.x, uv, gdx, gdy);
#else
  if (L.x == L.y && L.x == L.z && L.x == L.w) {
    col = layerTex(L.x, uv, gdx, gdy);
  } else {
    col = layerTex(L.x, uv, gdx, gdy) * w.x + layerTex(L.y, uv, gdx, gdy) * w.y
        + layerTex(L.z, uv, gdx, gdy) * w.z + layerTex(L.w, uv, gdx, gdy) * w.w;
  }
#endif

  // Blight overlay with a darker creeping edge.
  vec4 B = vec4(d00.g, d10.g, d01.g, d11.g);
  float anyB = max(max(B.x, B.y), max(B.z, B.w));
  float bmask = 0.0;
  if (anyB > 0.5) {
    float bl = dot(B, bil) + (nz.r - 0.5) * 0.55 + (nz.b - 0.5) * 0.3;
    bmask = smoothstep(0.4, 0.56, bl);
    vec3 bc = layerTex(uBlightLayer, uv, gdx, gdy);
    col = mix(col, bc, bmask);
    col *= 1.0 - 0.4 * (1.0 - abs(bmask * 2.0 - 1.0));
  }

  // Cliff rock on steep slopes (biplanar so walls don't stretch).
  vec3 wn = normalize(vWNormal);
  float slope = 1.0 - wn.y;
  float rockW = smoothstep(0.3, 0.52, slope + (nz.g - 0.5) * 0.22);
  rockW = max(rockW, vWall * 0.85);
  // Derivatives must be taken in uniform control flow (undefined inside the branch → huge
  // gradients → pathological anisotropic sampling on some GPUs).
  vec2 uvA = vec2(vWPos.x, -vWPos.y) / 320.0;
  vec2 uvB = vec2(vWPos.z, -vWPos.y) / 320.0;
  vec2 gAx = dFdx(uvA);
  vec2 gAy = dFdy(uvA);
  vec2 gBx = dFdx(uvB);
  vec2 gBy = dFdy(uvB);
  if (TDBG == 0 && rockW > 0.001) {
    float darkCliff = max(max(d00.b, d10.b), max(d01.b, d11.b));
    float rl = (darkCliff > 0.5 || bmask > 0.5) ? uCliffDarkLayer : uCliffLayer;
    float bw = abs(wn.x) / (abs(wn.x) + abs(wn.z) + 1e-4);
    vec3 ra = textureGrad(uLayers, vec3(uvA, rl), gAx, gAy).rgb;
    vec3 rb = textureGrad(uLayers, vec3(uvB, rl), gBx, gBy).rgb;
    col = mix(col, mix(ra, rb, bw), rockW);
  }

  // Macro variation (breaks tiling) + fine detail near the camera.
  float macro = texture(uNoise, vSplat * 0.031).r;
  col *= 0.8 + 0.4 * macro;
  col *= 0.9 + 0.2 * texture(uNoise, vSplat * 2.9).b;

  // Riverbed: teal tint and darkening with depth.
  if (vWater > 0.0) {
    float dw = smoothstep(0.0, 70.0, vWater);
    col = mix(col, col * vec3(0.45, 0.78, 0.8), dw);
  }
  col *= vAO;
  diffuseColor.rgb = col;
`;

let debugLevel = 0;
/** Dev-only: simplify the splat shader (1 = single sample, 2 = no rock, 3 = flat colour) to bisect cost. */
export const setTerrainDebugLevel = (level: number): void => {
  debugLevel = level;
};

export const createTerrain = (map: LoadedMap, textures?: GroundTextures): Terrain => {
  const t = map.data.terrain;
  const grid = buildTerrainGrid(map, 3);
  const tex = textures ?? createGroundTextures();
  const ownsTextures = !textures;
  const layerOf = groundLayersFor(t.groundTextures);
  const northernTileset = NORTHERN.has(t.tileset.toUpperCase());

  // Per-tilepoint data texture: R = ground layer, G = blight, B = dark-cliff hint.
  const tileData = new Uint8Array(t.cols * t.rows * 4);
  for (let i = 0; i < t.cols * t.rows; i++) {
    const layer = layerOf[map.texture[i]!] ?? GroundLayer.GrassAshen;
    const flags = map.tileFlags[i]!;
    const darkLayer =
      layer === GroundLayer.Snow ||
      layer === GroundLayer.Ice ||
      layer === GroundLayer.DirtNorth ||
      layer === GroundLayer.GrassNorth ||
      layer === GroundLayer.Dark ||
      layer === GroundLayer.Blight;
    tileData[i * 4] = layer;
    tileData[i * 4 + 1] = flags & TileFlag.Blight ? 255 : 0;
    tileData[i * 4 + 2] = darkLayer || northernTileset ? 255 : 0;
    tileData[i * 4 + 3] = 255;
  }
  const tileTex = new DataTexture(tileData, t.cols, t.rows, RGBAFormat, UnsignedByteType);
  tileTex.magFilter = NearestFilter;
  tileTex.minFilter = NearestFilter;
  tileTex.generateMipmaps = false;
  tileTex.needsUpdate = true;

  const material = new MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLayers = { value: tex.layers };
    shader.uniforms.uTileData = { value: tileTex };
    shader.uniforms.uNoise = { value: tex.noise };
    shader.uniforms.uGridMax = { value: new Vector2(t.cols - 1, t.rows - 1) };
    shader.uniforms.uCliffLayer = { value: GroundLayer.Cliff };
    shader.uniforms.uCliffDarkLayer = { value: GroundLayer.CliffDark };
    shader.uniforms.uBlightLayer = { value: GroundLayer.Blight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SPLAT_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SPLAT_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define TDBG ${debugLevel}\n${SPLAT_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', SPLAT_FRAGMENT);
  };
  material.customProgramCacheKey = () => `wc3-terrain-${debugLevel}`;

  // --- Chunk meshes -----------------------------------------------------------
  const object3D = new Group();
  object3D.name = 'terrain';
  const S = grid.S;
  const cs = CHUNK_TILES * S;
  const nCx = Math.ceil((grid.cols - 1) / cs);
  const nCy = Math.ceil((grid.rows - 1) / cs);
  const geometries: BufferGeometry[] = [];
  for (let cy = 0; cy < nCy; cy++) {
    for (let cx = 0; cx < nCx; cx++) {
      const gx0 = cx * cs;
      const gy0 = cy * cs;
      const gx1 = Math.min(gx0 + cs, grid.cols - 1);
      const gy1 = Math.min(gy0 + cs, grid.rows - 1);
      const w = gx1 - gx0 + 1;
      const h = gy1 - gy0 + 1;
      const pos = new Float32Array(w * h * 3);
      const nrm = new Float32Array(w * h * 3);
      const splat = new Float32Array(w * h * 2);
      const aoA = new Float32Array(w * h);
      const water = new Float32Array(w * h);
      const wall = new Float32Array(w * h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const g = (gy0 + j) * grid.cols + gx0 + i;
          const v = j * w + i;
          // WC3 → three: (x, z, -y)
          pos[v * 3] = grid.px[g]!;
          pos[v * 3 + 1] = grid.pz[g]!;
          pos[v * 3 + 2] = -grid.py[g]!;
          nrm[v * 3] = grid.normal[g * 3]!;
          nrm[v * 3 + 1] = grid.normal[g * 3 + 2]!;
          nrm[v * 3 + 2] = -grid.normal[g * 3 + 1]!;
          splat[v * 2] = (gx0 + i) / S;
          splat[v * 2 + 1] = (gy0 + j) / S;
          aoA[v] = grid.ao[g]!;
          const wz = grid.waterZ[g]!;
          water[v] = Number.isNaN(wz) ? -1000 : wz - grid.pz[g]!;
          wall[v] = grid.wall[g]!;
        }
      }
      const idx = new Uint32Array((w - 1) * (h - 1) * 6);
      let k = 0;
      for (let j = 0; j < h - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i;
          const b = a + 1;
          const c = a + w;
          const d = c + 1;
          // Split along the flatter diagonal (keeps cliff silhouettes clean).
          const dad = Math.abs(pos[a * 3 + 1]! - pos[d * 3 + 1]!);
          const dbc = Math.abs(pos[b * 3 + 1]! - pos[c * 3 + 1]!);
          // Grid rows go north (−z in three); CCW winding seen from +y.
          if (dad <= dbc) {
            idx[k++] = a; idx[k++] = b; idx[k++] = d;
            idx[k++] = a; idx[k++] = d; idx[k++] = c;
          } else {
            idx[k++] = a; idx[k++] = b; idx[k++] = c;
            idx[k++] = b; idx[k++] = d; idx[k++] = c;
          }
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(nrm, 3));
      geo.setAttribute('aSplat', new BufferAttribute(splat, 2));
      geo.setAttribute('aAO', new BufferAttribute(aoA, 1));
      geo.setAttribute('aWater', new BufferAttribute(water, 1));
      geo.setAttribute('aWall', new BufferAttribute(wall, 1));
      geo.setIndex(new BufferAttribute(idx, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      geometries.push(geo);
      const mesh = new Mesh(geo, material);
      mesh.name = `terrain_${cx}_${cy}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      object3D.add(mesh);
    }
  }

  return {
    object3D,
    grid,
    material,
    heightAt: (x, y) => gridHeightAt(grid, x, y),
    isBlight: (x, y) => {
      const ix = Math.min(t.cols - 1, Math.max(0, Math.round((x - t.originX) / t.cellSize)));
      const iy = Math.min(t.rows - 1, Math.max(0, Math.round((y - t.originY) / t.cellSize)));
      return (map.tileFlags[iy * t.cols + ix]! & TileFlag.Blight) !== 0;
    },
    chunkCount: nCx * nCy,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      material.dispose();
      tileTex.dispose();
      if (ownsTextures) tex.dispose();
    },
  };
};
