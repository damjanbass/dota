// Public world API: renders a LoadedMap (real or mock) in a WC3 art style.
//   const world = createWorld({ scene, renderer, map });
//   loop: world.update(dt, camera.position); renderer.render(scene, camera);
import { Group, PCFShadowMap, Vector3 } from 'three';
import type { Mesh, Object3D, Scene, WebGLRenderer } from 'three';
import { facingToThreeYaw, toThree } from '../core/coords';
import type { LoadedMap } from '../core/map';
import { createBuildingModel, createDecorModel, createRoshanPitModel, disposeBuildingCache, isBuildingKind } from './buildings';
import { createDayNight } from './daynight';
import type { DayNight } from './daynight';
import { createDoodads, disposeDoodadCache } from './doodads';
import type { DoodadKind } from './doodads';
import { createGlowMesh, disposeGlowShared, setGlowsVisible } from './glow';
import type { GlowSpec } from './glow';
import { disposeSharedMaterials, worldUniforms } from './materials';
import { createSky } from './sky';
import { createTerrain } from './terrain';
import type { Terrain } from './terrain';
import { disposeTreeGeometries } from './treeModels';
import type { TreeKind } from './treeModels';
import { createTrees } from './trees';
import { disposeUnitCache } from './units';
import { roshanPitFacing } from './views';
import { createWater } from './water';

export { createBuildingModel, createDecorModel, createRoshanPitModel, BUILDING_KINDS } from './buildings';
export type { BuildingKind } from './buildings';
export { createUnitModel, resolveUnitModelId, UNIT_MODEL_IDS, UNIT_MODEL_HEIGHTS } from './units';
export type { AnimName, AnimatedModel, PlayOptions, UnitModelId, UnitModelOptions } from './units';
export { createTerrain } from './terrain';
export type { Terrain } from './terrain';
export { computeView, MAP_VIEWS } from './views';
export type { MapViewName, ViewPreset } from './views';

export interface WorldOptions {
  scene: Scene;
  renderer: WebGLRenderer;
  map: LoadedMap;
  /** 0..1 over a 24 h day (0.25 = 06:00 dawn, 0.5 = noon, 0.75 = 18:00 dusk). Default 0.4. */
  timeOfDay?: number;
  /** Sun/moon shadows near the camera (default true). */
  shadows?: boolean;
  /** Shadow map resolution (default 2048). */
  shadowMapSize?: number;
}

export interface WorldStats {
  /** From renderer.info (last rendered frame, incl. shadow passes). */
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  terrainChunks: number;
  trees: number;
  treeKinds: Record<TreeKind, number>;
  doodads: Record<DoodadKind, number>;
  buildings: number;
}

export interface World {
  /** Everything the world adds lives under this group. */
  root: Group;
  terrain: Terrain;
  dayNight: DayNight;
  /** Placed building / decor models by map entity id. */
  buildings: ReadonlyMap<number, Object3D>;
  /** Visual ground height (WC3 x, y → z), matches the rendered terrain incl. cliffs. */
  heightAt(x: number, y: number): number;
  /**
   * Per-frame update. `cameraPos` is in three.js world space (e.g. camera.position):
   * drives tree LOD, the camera-following shadow frustum and the sky dome.
   */
  update(dt: number, cameraPos: Vector3): void;
  setTimeOfDay(t01: number): void;
  readonly timeOfDay: number;
  /** Hide/show a placed building (and its glows) by map entity id, e.g. when destroyed. */
  setBuildingVisible(entityId: number, visible: boolean): void;
  /** Hide/show a tree by its index in map.data.trees (cut-down trees). */
  setTreeVisible(index: number, visible: boolean): void;
  getStats(): WorldStats;
  dispose(): void;
}

export const createWorld = ({ scene, renderer, map, timeOfDay = 0.4, shadows = true, shadowMapSize }: WorldOptions): World => {
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;

  const root = new Group();
  root.name = 'world';

  const sky = createSky();
  root.add(sky.mesh);
  const dayNight = createDayNight(sky, { shadowMapSize });
  dayNight.sun.castShadow = shadows;
  root.add(dayNight.root);
  const prevFog = scene.fog;
  scene.fog = dayNight.fog;

  const terrain = createTerrain(map);
  root.add(terrain.object3D);
  const water = createWater(terrain.grid);
  if (water.mesh) root.add(water.mesh);
  const trees = createTrees(map, terrain.heightAt, terrain.isBlight);
  root.add(trees.group);
  const doodads = createDoodads(map, terrain.heightAt, terrain.isBlight);
  root.add(doodads.group);

  // Buildings, the Roshan pit and decorative structures from map entities.
  const buildingGroup = new Group();
  buildingGroup.name = 'buildings';
  root.add(buildingGroup);
  const buildings = new Map<number, Object3D>();
  // All building glows go into ONE world-space billboard mesh (1 draw call).
  const glows: GlowSpec[] = [];
  const glowRange = new Map<number, [number, number]>();
  const gp = new Vector3();
  const noGlow = { glow: false };
  for (const e of map.data.entities) {
    let model: Object3D | null = null;
    let facing = e.facing;
    if (isBuildingKind(e.kind)) model = createBuildingModel(e.kind, e.team, e.tier ?? 1, noGlow);
    else if (e.kind === 'roshan') {
      model = createRoshanPitModel(noGlow);
      facing = roshanPitFacing(map, e.x, e.y, terrain.heightAt);
    } else if (e.kind === 'other') model = createDecorModel(e.name, e.team, noGlow);
    if (!model) continue;
    // Sit on the lowest ground under the footprint so nothing floats on slopes.
    const r = ((model.userData.radius as number | undefined) ?? 100) * 0.6;
    let z = terrain.heightAt(e.x, e.y);
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) z = Math.min(z, terrain.heightAt(e.x + dx, e.y + dy));
    toThree(e.x, e.y, z - 4, model.position);
    model.rotation.y = facingToThreeYaw(facing);
    model.userData.entityId = e.id;
    model.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    model.updateMatrixWorld(true);
    const specs = (model.userData.glows as GlowSpec[] | undefined) ?? [];
    glowRange.set(e.id, [glows.length, specs.length]);
    for (const g of specs) {
      gp.set(g.p[0], g.p[1], g.p[2]).applyMatrix4(model.matrixWorld);
      glows.push({ p: [gp.x, gp.y, gp.z], size: g.size * model.scale.x, color: g.color, intensity: g.intensity });
    }
    buildingGroup.add(model);
    buildings.set(e.id, model);
  }
  const glowMesh: Mesh | null = createGlowMesh(glows);
  if (glowMesh) root.add(glowMesh);

  scene.add(root);
  dayNight.setTimeOfDay(timeOfDay);

  return {
    root,
    terrain,
    dayNight,
    buildings,
    heightAt: terrain.heightAt,
    update: (dt, cameraPos) => {
      worldUniforms.uTime.value += dt;
      sky.update(cameraPos);
      dayNight.update(cameraPos);
      trees.update(cameraPos);
    },
    setTimeOfDay: (t) => dayNight.setTimeOfDay(t),
    get timeOfDay() {
      return dayNight.timeOfDay;
    },
    setTreeVisible: (i, v) => trees.setTreeVisible(i, v),
    setBuildingVisible: (id, visible) => {
      const m = buildings.get(id);
      if (m) m.visible = visible;
      const r = glowRange.get(id);
      if (r && glowMesh && r[1] > 0) setGlowsVisible(glowMesh, r[0], r[1], visible);
    },
    getStats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
      terrainChunks: terrain.chunkCount,
      trees: trees.count,
      treeKinds: trees.kinds,
      doodads: doodads.counts,
      buildings: buildings.size,
    }),
    dispose: () => {
      scene.remove(root);
      if (scene.fog === dayNight.fog) scene.fog = prevFog;
      terrain.dispose();
      water.dispose();
      trees.dispose();
      doodads.dispose();
      sky.dispose();
      glowMesh?.geometry.dispose();
      dayNight.dispose();
      disposeBuildingCache();
      disposeTreeGeometries();
      disposeDoodadCache();
      disposeUnitCache();
      disposeGlowShared();
      disposeSharedMaterials();
    },
  };
};
