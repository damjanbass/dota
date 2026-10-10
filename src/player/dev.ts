// ?scene=fps — firing range on the loaded map (mock or real): debug terrain, dummies at 500 / 1000 / 2000 units
// (+ one strafing at 750), hitmarkers, HEADSHOT popup and a debug HUD. ?test=1 exposes window.__player hooks.
import {
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { EYE_HEIGHT, VIEW_DISTANCE } from '../core/config';
import { toThree } from '../core/coords';
import { EventBus } from '../core/events';
import { groundHeightAt } from '../core/map';
import { createMockMap } from '../core/mockMap';
import { SNIPER } from '../data/sniper';
import type { LoadedMap } from '../core/map';
import { startLoop } from '../core/loop';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';
import type { GameEvents, Hittable, ShotResult, Vec3 } from '../core/types';
import type { Obstacle, ObstacleProvider } from './controller';
import { createDevBuildings, createDevTerrain } from './devTerrain';
import { TreeGrid, castShot, headCenterZ, hitboxFor } from './hitbox';
import type { ShotWorld } from './hitbox';
import { DEFAULT_PLAYER_STATS, createPlayer, findSpawn } from './index';
import { PlayerController } from './controller';

/** Hero-sized dummies: Sniper's own collision radius / height from src/data (height is a data estimate). */
const DUMMY_SIZE = { collisionRadius: SNIPER.collisionRadius, height: SNIPER.height };
/** Range lane: distance along the lane + lateral offset (right, units) so no dummy hides another. */
const DUMMY_SPOTS = [
  { distance: 500, side: -60 },
  { distance: 1000, side: 80 },
  { distance: 2000, side: -20 },
];
const STRAFER = { distance: 750, side: 0, amplitude: 170, speed: 150 };
/**
 * Dev override so the 2000-unit dummy is reachable. Sniper's real range is scaledRange(550) = 1100 at level 1
 * (+100..400 Take Aim); try it with ?range=1100. ?cd=<seconds> overrides the shot interval.
 */
const DEV_RANGE = 2500;

interface Dummy extends Hittable {
  label: string;
  distance: number;
  group: Group;
  bodyMat: MeshLambertMaterial;
  headMat: MeshLambertMaterial;
  flash: number;
  flashHead: boolean;
  prev: Vec3;
  base: Vec3;
  strafe: { x: number; y: number; amplitude: number; omega: number } | null;
}

declare global {
  interface Window {
    __dummies?: Array<{ id: number; label: string; distance: number; x: number; y: number; z: number; headZ: number; headRadius: number }>;
  }
}

/** Picks the clearest direction from the spawn (line of sight + walkable spots), preferring the map centre. */
const chooseRangeDirection = (
  map: LoadedMap,
  spawn: { x: number; y: number },
  world: ShotWorld,
  obstacles: readonly Obstacle[],
): number => {
  const probe = new PlayerController(map, { x: spawn.x, y: spawn.y });
  const eye = probe.eye();
  const toCentre = Math.atan2((map.data.bounds.minY + map.data.bounds.maxY) / 2 - spawn.y, (map.data.bounds.minX + map.data.bounds.maxX) / 2 - spawn.x);
  let best = toCentre;
  let bestScore = -Infinity;
  const spots = [...DUMMY_SPOTS, STRAFER];
  for (let k = 0; k < 48; k++) {
    const yaw = (k / 48) * Math.PI * 2;
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    let score = 0;
    for (const s of spots) {
      const x = spawn.x + dx * s.distance + dy * s.side;
      const y = spawn.y + dy * s.distance - dx * s.side;
      const free = !probe.hullBlocked(x, y) && obstacles.every((o) => Math.hypot(o.x - x, o.y - y) > o.radius + 60);
      const z = groundHeightAt(map, x, y) + DUMMY_SIZE.height * 0.6;
      const dir = { x: x - eye.x, y: y - eye.y, z: z - eye.z };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= len;
      dir.y /= len;
      dir.z /= len;
      const clear = castShot(eye, dir, len - 30, [], world).blockedBy === 'range';
      score += (free ? 1 : 0) + (clear ? 2 : 0);
    }
    score += 0.5 * Math.cos(yaw - toCentre);
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  return best;
};

const makeLabel = (text: string): Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(28, 14, 200, 68);
  ctx.font = 'bold 52px Verdana, sans-serif';
  ctx.fillStyle = '#ffd84a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(84, 32, 1);
  return sprite;
};

const createDummy = (id: number, label: string, distance: number, x: number, y: number, map: LoadedMap): Dummy => {
  const shape = hitboxFor(DUMMY_SIZE);
  const z = groundHeightAt(map, x, y);
  const group = new Group();
  const bodyMat = new MeshLambertMaterial({ color: 0xb08850, flatShading: true });
  const headMat = new MeshLambertMaterial({ color: 0xe0c89a, flatShading: true });
  const bodyLen = Math.max(0, shape.bodyHeight - 2 * shape.bodyRadius);
  const body = new Mesh(new CapsuleGeometry(shape.bodyRadius, bodyLen, 3, 10), bodyMat);
  body.position.y = shape.bodyHeight / 2;
  const head = new Mesh(new SphereGeometry(shape.headRadius, 12, 8), headMat);
  head.position.y = shape.bodyHeight + shape.headRadius;
  const ring = new Mesh(new CylinderGeometry(shape.bodyRadius * 0.55, shape.bodyRadius * 0.55, 1, 12), new MeshLambertMaterial({ color: 0xb02020 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, shape.bodyHeight * 0.62, shape.bodyRadius * 0.92);
  const post = new Mesh(new CylinderGeometry(2.5, 2.5, 40, 6), new MeshLambertMaterial({ color: 0x5a3c22 }));
  post.position.y = -10;
  const tag = makeLabel(label);
  tag.position.y = shape.bodyHeight + shape.headRadius * 2 + 34;
  group.add(body, head, ring, post, tag);
  group.position.copy(toThree(x, y, z));
  return {
    id,
    team: 'scourge',
    position: { x, y, z },
    ...shape,
    alive: true,
    label,
    distance,
    group,
    bodyMat,
    headMat,
    flash: 0,
    flashHead: false,
    prev: { x, y, z },
    base: { x, y, z },
    strafe: null,
  };
};

export const run: SceneRunner = ({ canvas, ui, map: loadedMap }) => {
  const params = new URLSearchParams(location.search);
  const testMode = params.get('test') === '1';
  // ?map=mock forces the procedural map even when the real extraction is present.
  const map = params.get('map') === 'mock' ? createMockMap() : loadedMap;

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const sky = new Color(0x9cb9d4);
  const scene = new Scene();
  scene.background = sky;
  scene.fog = new Fog(sky, 3500, 15000);
  scene.add(new HemisphereLight(0xd6e6ff, 0x5a4a32, 1.3));
  const sun = new DirectionalLight(0xfff0d6, 2.6);
  sun.position.set(0.5, 1, 0.35);
  scene.add(sun);

  const camera = new PerspectiveCamera(74, window.innerWidth / window.innerHeight, 4, VIEW_DISTANCE);
  const terrain = createDevTerrain(map);
  const buildings = createDevBuildings(map);
  scene.add(terrain.group, buildings.group);

  // --- firing range layout ----------------------------------------------------------------------
  const trees = new TreeGrid(map.data.trees);
  const world: ShotWorld = { map, trees, buildings: buildings.blockers };
  const spawn = findSpawn(map);
  const yaw = chooseRangeDirection(map, spawn, world, buildings.obstacles);
  const dx = Math.cos(yaw);
  const dy = Math.sin(yaw);
  // Lateral offsets go along right = (dy, -dx).
  const at = (s: { distance: number; side: number }): [number, number] => [spawn.x + dx * s.distance + dy * s.side, spawn.y + dy * s.distance - dx * s.side];
  const dummies: Dummy[] = DUMMY_SPOTS.map((s, i) => createDummy(i + 1, `${s.distance}`, s.distance, ...at(s), map));
  const strafer = createDummy(DUMMY_SPOTS.length + 1, `${STRAFER.distance}~`, STRAFER.distance, ...at(STRAFER), map);
  strafer.strafe = { x: -dy, y: dx, amplitude: STRAFER.amplitude, omega: STRAFER.speed / STRAFER.amplitude };
  dummies.push(strafer);
  for (const d of dummies) {
    d.group.rotation.y = Math.atan2(-dx, dy); // bullseye (+Z local) faces the spawn
    scene.add(d.group);
  }
  window.__dummies = dummies.map((d) => ({ id: d.id, label: d.label, distance: d.distance, x: d.position.x, y: d.position.y, z: d.position.z, headZ: headCenterZ(d), headRadius: d.headRadius }));

  // Static buildings + dummies; the strafer's entry is moved every tick.
  const dummyObstacles: Obstacle[] = dummies.map((d) => ({ x: d.position.x, y: d.position.y, radius: d.bodyRadius }));
  const allObstacles: Obstacle[] = [...buildings.obstacles, ...dummyObstacles];
  const nearby: Obstacle[] = [];
  const obstacles: ObstacleProvider = {
    obstaclesNear(x, y, radius) {
      nearby.length = 0;
      for (const o of allObstacles) {
        const reach = o.radius + radius;
        if (Math.abs(o.x - x) < reach && Math.abs(o.y - y) < reach) nearby.push(o);
      }
      return nearby;
    },
  };

  const events = new EventBus<GameEvents>();
  const range = Number(params.get('range') ?? DEV_RANGE);
  const fireInterval = Number(params.get('cd') ?? DEFAULT_PLAYER_STATS.fireInterval);
  const player = createPlayer({
    map,
    camera,
    scene,
    events,
    ui,
    pointerLockTarget: canvas,
    obstacles,
    targets: () => dummies,
    buildings: () => buildings.blockers,
    trees,
    stats: { range, fireInterval },
    spawn: { x: spawn.x, y: spawn.y, yaw },
    testMode,
  });
  player.resize(window.innerWidth, window.innerHeight);

  // --- HUD --------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .dev-hud { position: absolute; left: 8px; top: 8px; margin: 0; padding: 8px 10px; background: rgba(0,0,0,0.55);
      font: 12px/1.45 Consolas, monospace; color: #dfe; white-space: pre; }
    .dev-hint { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); font: 12px Verdana, sans-serif;
      color: #fff; text-shadow: 0 1px 2px #000; opacity: 0.85; }
    .dev-click { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); padding: 14px 22px;
      background: rgba(0,0,0,0.6); border: 1px solid #c9a03a; color: #ffd84a; font: bold 18px Verdana, sans-serif; }
    .dev-hit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
    .dev-hit i { position: absolute; width: 9px; height: 2px; background: #fff; box-shadow: 0 0 2px #000; }
    .dev-hit.head i { background: #ff3030; }
    .dev-hit i:nth-child(1) { left: 5px; top: 5px; transform: rotate(45deg); }
    .dev-hit i:nth-child(2) { left: -14px; top: 5px; transform: rotate(-45deg); }
    .dev-hit i:nth-child(3) { left: 5px; top: -7px; transform: rotate(-45deg); }
    .dev-hit i:nth-child(4) { left: -14px; top: -7px; transform: rotate(45deg); }
    .dev-hs { position: absolute; left: 50%; top: 30%; transform: translate(-50%, 0); opacity: 0;
      font: bold 34px Verdana, sans-serif; color: #ff3a2a; letter-spacing: 3px; text-shadow: 0 2px 4px #000, 0 0 12px #f80; }
    .dev-hs.show { animation: dev-hs 1.1s ease-out forwards; }
    @keyframes dev-hs { 0% { opacity: 0; transform: translate(-50%, 10px) scale(1.4); } 12% { opacity: 1; transform: translate(-50%, 0) scale(1); }
      70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -24px); } }
  `;
  document.head.appendChild(style);
  const hud = document.createElement('pre');
  hud.className = 'dev-hud';
  const hint = document.createElement('div');
  hint.className = 'dev-hint';
  hint.textContent = 'WASD move · Space jump · Shift walk · LMB fire · RMB / E scope (x2) · Esc release mouse';
  const click = document.createElement('div');
  click.className = 'dev-click';
  click.textContent = 'Click to play';
  const hit = document.createElement('div');
  hit.className = 'dev-hit';
  hit.innerHTML = '<i></i><i></i><i></i><i></i>';
  const hs = document.createElement('div');
  hs.className = 'dev-hs';
  hs.textContent = 'HEADSHOT';
  ui.append(hud, hint, click, hit, hs);

  let hitTime = Infinity;
  let lastShot: ShotResult | null = null;
  events.on('player:shot', ({ result }) => {
    lastShot = result;
    const target = dummies.find((d) => d.id === result.targetId);
    if (!target) return;
    target.flash = 1;
    target.flashHead = result.part === 'head';
    hitTime = 0;
    hit.classList.toggle('head', result.part === 'head');
    if (result.part === 'head') {
      hs.classList.remove('show');
      void hs.offsetWidth; // restart the CSS animation
      hs.classList.add('show');
    }
  });

  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    player.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // --- loop -------------------------------------------------------------------------------------
  let simTime = 0;
  let ready = false;
  let hudTimer = 0;
  let frames = 0;
  let fps = 0;
  let fpsTimer = 0;
  const bodyColor = new Color(0xb08850);
  const headColor = new Color(0xe0c89a);
  const flashColor = new Color(0xff2020);
  const flashHeadColor = new Color(0xffe040);

  startLoop({
    update: (dt) => {
      simTime += dt;
      player.update(dt);
      for (let i = 0; i < dummies.length; i++) {
        const d = dummies[i]!;
        d.prev.x = d.position.x;
        d.prev.y = d.position.y;
        d.prev.z = d.position.z;
        if (!d.strafe) continue;
        const s = Math.sin(simTime * d.strafe.omega) * d.strafe.amplitude;
        d.position.x = d.base.x + d.strafe.x * s;
        d.position.y = d.base.y + d.strafe.y * s;
        d.position.z = groundHeightAt(map, d.position.x, d.position.y);
        dummyObstacles[i]!.x = d.position.x;
        dummyObstacles[i]!.y = d.position.y;
      }
    },
    render: (alpha, frameDt) => {
      player.render(alpha, frameDt);
      for (const d of dummies) {
        if (d.strafe) {
          toThree(
            d.prev.x + (d.position.x - d.prev.x) * alpha,
            d.prev.y + (d.position.y - d.prev.y) * alpha,
            d.prev.z + (d.position.z - d.prev.z) * alpha,
            d.group.position,
          );
        }
        if (d.flash > 0) {
          d.flash = Math.max(0, d.flash - frameDt * 3);
          (d.flashHead ? d.headMat : d.bodyMat).color.copy(d.flashHead ? headColor : bodyColor).lerp(d.flashHead ? flashHeadColor : flashColor, d.flash);
        }
      }
      renderer.render(scene, camera);
      player.renderOverlay(renderer);

      hitTime += frameDt;
      hit.style.opacity = hitTime < 0.3 ? String(1 - hitTime / 0.3) : '0';
      click.style.display = testMode || player.input.locked ? 'none' : 'block';

      frames++;
      fpsTimer += frameDt;
      if (fpsTimer >= 0.5) {
        fps = frames / fpsTimer;
        frames = 0;
        fpsTimer = 0;
      }
      hudTimer -= frameDt;
      if (hudTimer <= 0) {
        hudTimer = 0.1;
        const s = player.snapshot();
        const ls = lastShot as ShotResult | null;
        const shot = ls
          ? ls.targetId !== null
            ? `${ls.part} #${ls.targetId} @ ${ls.distance.toFixed(0)}u`
            : `${ls.blockedBy} @ ${ls.distance.toFixed(0)}u`
          : '-';
        hud.textContent = [
          `map     ${map.data.source}   fps ${fps.toFixed(0)}`,
          `speed   ${s.speed.toFixed(1)} u/s ${s.onGround ? '' : '(air)'}`,
          `pos     ${s.position.x.toFixed(0)}, ${s.position.y.toFixed(0)}, ${s.position.z.toFixed(1)}`,
          `groundZ ${s.groundZ.toFixed(1)}   eye ${(s.position.z + EYE_HEIGHT).toFixed(1)}`,
          `view    yaw ${((s.yaw * 180) / Math.PI).toFixed(1)}°  pitch ${((s.pitch * 180) / Math.PI).toFixed(1)}°`,
          `zoom    ${s.zoomLevel}   fov ${camera.fov.toFixed(1)}°`,
          `rifle   ${s.weaponReady ? 'ready' : `cycling ${(s.cycle * 100).toFixed(0)}%`}   range ${player.stats.range.toFixed(0)}  cd ${player.stats.fireInterval.toFixed(2)}s`,
          `shot    ${shot}   shots ${s.shots}`,
        ].join('\n');
      }

      if (!ready) {
        ready = true;
        markSceneReady();
      }
    },
  });
};
