// ?scene=game — the integrated game. Gate 1: real DotA world + FPS Sniper + building collision.
// Wave 2 plugs in the sim (units, creeps, towers), Sniper kit, bots and HUD here.
import { InstancedMesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { Mesh, Object3D } from 'three';
import { PLAYER_RADIUS, VIEW_DISTANCE } from '../core/config';
import { EventBus } from '../core/events';
import { isWalkable } from '../core/map';
import { startLoop } from '../core/loop';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';
import type { GameEvents } from '../core/types';
import { TreeGrid, createPlayer } from '../player';
import { createWorld } from '../world';
import { createBuildingColliders } from './buildingColliders';

/**
 * Ground footprint radius of each placed building model: the farthest vertex (horizontally) within
 * BASE_HEIGHT of the model's feet, × 0.85 so square plinths aren't over-blocked at their corners.
 * Canopies, glows and spires above the base are ignored.
 */
const BASE_HEIGHT = 100;
const modelFootprints = (buildings: ReadonlyMap<number, Object3D>): Map<number, number> => {
  const v = new Vector3();
  const out = new Map<number, number>();
  for (const [id, obj] of buildings) {
    obj.updateWorldMatrix(true, true);
    const origin = obj.getWorldPosition(new Vector3());
    let r2 = 0;
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || mesh instanceof InstancedMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y - origin.y > BASE_HEIGHT) continue;
        r2 = Math.max(r2, (v.x - origin.x) ** 2 + (v.z - origin.z) ** 2);
      }
    });
    out.set(id, 0.85 * Math.sqrt(r2));
  }
  return out;
};

declare global {
  interface Window {
    __game?: { canStand(x: number, y: number): boolean };
  }
}

export const run: SceneRunner = ({ canvas, ui, map }) => {
  const params = new URLSearchParams(location.search);
  const dpr = Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 1.5));
  const timeOfDay = Number(params.get('t') ?? 0.4);

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // The viewmodel overlay is a second render pass; reset stats per frame so the debug readout counts both.
  renderer.info.autoReset = false;
  const scene = new Scene();
  const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 4, VIEW_DISTANCE);

  const world = createWorld({ scene, renderer, map, timeOfDay });
  const footprints = modelFootprints(world.buildings);
  const colliders = createBuildingColliders(map, footprints);
  if (params.has('debug')) console.info('building footprints', Object.fromEntries(footprints));
  const events = new EventBus<GameEvents>();
  const player = createPlayer({
    map,
    camera,
    scene,
    events,
    ui,
    pointerLockTarget: canvas,
    obstacles: colliders,
    buildings: () => colliders.blockers,
    trees: new TreeGrid(map.data.trees),
  });

  if (params.get('test') === '1') {
    // Test hook: can the player stand at (x, y)? Terrain pathing + trees + building colliders.
    window.__game = {
      canStand: (x, y) => {
        if (!isWalkable(map, x, y)) return false;
        for (const _ of colliders.obstaclesNear(x, y, PLAYER_RADIUS)) return false;
        return true;
      },
    };
  }

  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    player.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const debug = document.createElement('pre');
  debug.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:#0008;color:#dfe;font:12px/1.35 monospace;pointer-events:none';
  debug.hidden = !params.has('debug');
  ui.appendChild(debug);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      debug.hidden = !debug.hidden;
      e.preventDefault();
    }
  });

  let frames = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;
  startLoop({
    update: (dt) => player.update(dt),
    render: (alpha, frameDt) => {
      renderer.info.reset();
      player.render(alpha, frameDt);
      world.update(frameDt, camera.position);
      renderer.render(scene, camera);
      player.renderOverlay(renderer);

      fpsAcc += frameDt;
      fpsFrames++;
      if (fpsAcc >= 0.5) {
        fps = fpsFrames / fpsAcc;
        fpsAcc = 0;
        fpsFrames = 0;
      }
      if (!debug.hidden) {
        const s = player.snapshot();
        const st = world.getStats();
        debug.textContent =
          `fps ${fps.toFixed(0)}  calls ${st.drawCalls}  tris ${(st.triangles / 1000).toFixed(0)}k\n` +
          `pos ${s.position.x.toFixed(0)}, ${s.position.y.toFixed(0)}, ${s.position.z.toFixed(0)}  speed ${s.speed.toFixed(0)}\n` +
          `zoom ${s.zoomLevel}  shots ${s.shots}`;
      }
      if (++frames === 2) markSceneReady();
    },
  });
};
