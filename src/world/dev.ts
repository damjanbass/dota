// ?scene=world — free-fly viewer for the world art.
//   ?view=sentinel_base|scourge_base|mid|river|roshan|showcase|showcase_units   (default: mid)
//   ?t=0..1 time of day   ?anim=idle|walk|attack|death   ?units=0 (no demo units)   ?dpr=1
// Controls: WASD fly, drag mouse to look, Shift fast, Space/C up/down, G snap to eye height,
//           T cycle time of day.
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { EYE_HEIGHT, VIEW_DISTANCE } from '../core/config';
import { facingToThreeYaw, fromThree, toThree } from '../core/coords';
import type { LoadedMap } from '../core/map';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';
import type { Vec3 } from '../core/types';
import { createUnitModel, createWorld, UNIT_MODEL_IDS } from './index';
import type { AnimName, AnimatedModel, World, WorldStats } from './index';
import { setTerrainDebugLevel } from './terrain';
import { SHOWCASE_GROUND, SHOWCASE_ROWS, createShowcaseMap } from './showcaseMap';
import { MAP_VIEWS, computeView, eyeAt, roshanPitFacing } from './views';
import type { MapViewName, ViewPreset } from './views';

declare global {
  interface Window {
    __worldStats?: WorldStats & { fps: number; view: string; frameMs: number; cpuMs: number };
  }
}

const SHOWCASE_VIEWS = ['showcase', 'showcase_units'] as const;
type ShowcaseView = (typeof SHOWCASE_VIEWS)[number];
const ANIMS: readonly AnimName[] = ['idle', 'walk', 'attack', 'death'];

interface DemoUnit {
  model: AnimatedModel;
  x: number;
  y: number;
}

const placeUnit = (world: World, id: string, x: number, y: number, facing: number, anim: AnimName, units: DemoUnit[]): void => {
  const model = createUnitModel(id);
  toThree(x, y, world.heightAt(x, y), model.object3D.position);
  model.object3D.rotation.y = facingToThreeYaw(facing);
  model.play(anim);
  world.root.add(model.object3D);
  units.push({ model, x, y });
};

/** A small creep clash between the mid tier-1 towers so the screenshot reads as DotA. */
const demoUnitsForView = (map: LoadedMap, world: World, view: MapViewName, anim: AnimName | null, units: DemoUnit[]): void => {
  if (view === 'mid') {
    const s1 = map.data.entities.find((e) => e.kind === 'tower' && e.team === 'sentinel' && e.lane === 'mid' && e.tier === 1);
    const u1 = map.data.entities.find((e) => e.kind === 'tower' && e.team === 'scourge' && e.lane === 'mid' && e.tier === 1);
    if (!s1 || !u1) return;
    const dx = u1.x - s1.x;
    const dy = u1.y - s1.y;
    const len = Math.hypot(dx, dy);
    const fx = dx / len;
    const fy = dy / len;
    const f = Math.atan2(fy, fx);
    const meet = 0.36;
    const wave = (ids: string[], t: number, facing: number): void =>
      ids.forEach((id, i) => {
        const side = (i - (ids.length - 1) / 2) * 70;
        const x = s1.x + dx * t - fy * side;
        const y = s1.y + dy * t + fx * side;
        placeUnit(world, id, x, y, facing, anim ?? (i % 2 ? 'attack' : 'walk'), units);
      });
    wave(['treant', 'treant', 'archer', 'treant'], meet - 70 / len, f);
    wave(['ghoul', 'ghoul', 'necrolyte', 'ghoul'], meet + 70 / len, f + Math.PI);
    placeUnit(world, 'glaive_thrower', s1.x + dx * (meet - 260 / len), s1.y + dy * (meet - 260 / len), f, anim ?? 'walk', units);
    placeUnit(world, 'meat_wagon', s1.x + dx * (meet + 280 / len), s1.y + dy * (meet + 280 / len), f + Math.PI, anim ?? 'attack', units);
    placeUnit(world, 'pudge', s1.x + dx * (meet + 520 / len) + fy * 160, s1.y + dy * (meet + 520 / len) - fx * 160, f + Math.PI, anim ?? 'idle', units);
  } else if (view === 'roshan') {
    const r = map.data.entities.find((e) => e.kind === 'roshan');
    if (!r) return;
    const f = roshanPitFacing(map, r.x, r.y, world.heightAt);
    placeUnit(world, 'roshan', r.x - Math.cos(f) * 60, r.y - Math.sin(f) * 60, f, anim ?? 'idle', units);
  } else if (view === 'sentinel_base' || view === 'scourge_base') {
    const team = view === 'sentinel_base' ? 'sentinel' : 'scourge';
    const fountain = map.data.entities.find((e) => e.kind === 'fountain' && e.team === team);
    const ancient = map.data.entities.find((e) => e.kind === 'ancient' && e.team === team);
    if (!fountain || !ancient) return;
    const ids = team === 'sentinel' ? ['treant', 'archer', 'treant'] : ['ghoul', 'necrolyte', 'ghoul'];
    const f = Math.atan2(ancient.y - fountain.y, ancient.x - fountain.x);
    ids.forEach((id, i) => {
      const t = 0.42 + i * 0.05;
      placeUnit(world, id, fountain.x + (ancient.x - fountain.x) * t + (i - 1) * 60, fountain.y + (ancient.y - fountain.y) * t, f, anim ?? 'walk', units);
    });
  }
};

const showcaseUnits = (world: World, anim: AnimName | null, units: DemoUnit[]): void => {
  const facing = (3 * Math.PI) / 2; // face the camera (south)
  const ids = [...UNIT_MODEL_IDS];
  const rows = [ids.slice(0, 10), ids.slice(10)];
  rows.forEach((row, r) => {
    const widths = row.map((id) => (id === 'roshan' ? 300 : id === 'dragon' || id === 'viper' || id === 'shadow_fiend' ? 190 : id === 'centaur' || id === 'meat_wagon' || id === 'glaive_thrower' ? 170 : 125));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    row.forEach((id, i) => {
      const w = widths[i]!;
      const a = anim ?? ANIMS[(i + r) % 3]!;
      placeUnit(world, id, x + w / 2, r === 0 ? SHOWCASE_ROWS.units : SHOWCASE_ROWS.unitsBack, facing, a, units);
      x += w;
    });
  });
};

const showcaseView = (view: ShowcaseView): ViewPreset => {
  const g = SHOWCASE_GROUND;
  if (view === 'showcase_units') {
    return { position: { x: 0, y: -260, z: g + 150 }, target: { x: 0, y: SHOWCASE_ROWS.units + 150, z: g + 60 } };
  }
  return { position: { x: 0, y: -1000, z: g + 420 }, target: { x: 0, y: SHOWCASE_ROWS.middle, z: g + 180 } };
};

export const run: SceneRunner = async ({ canvas, ui, map: loadedMap }) => {
  const params = new URLSearchParams(location.search);
  const viewParam = params.get('view') ?? 'mid';
  const isShowcase = (SHOWCASE_VIEWS as readonly string[]).includes(viewParam);
  const view = isShowcase || (MAP_VIEWS as readonly string[]).includes(viewParam) ? viewParam : 'mid';
  const map = isShowcase ? createShowcaseMap() : loadedMap;
  const animParam = params.get('anim');
  const anim = animParam && (ANIMS as readonly string[]).includes(animParam) ? (animParam as AnimName) : null;
  const tParam = params.get('t');
  const timeOfDay = tParam !== null && !Number.isNaN(Number(tParam)) ? Number(tParam) : isShowcase ? 0.45 : 0.4;
  const dpr = Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 1.5));

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new Scene();
  const camera = new PerspectiveCamera(isShowcase && view === 'showcase_units' ? 50 : 75, window.innerWidth / window.innerHeight, 4, VIEW_DISTANCE);

  setTerrainDebugLevel(Number(params.get('tdbg') ?? 0));
  const world = createWorld({ scene, renderer, map, timeOfDay });

  // Debug: ?off=shadows,terrain,trees,doodads,buildings,water,sky,units to bisect frame cost.
  const off = new Set((params.get('off') ?? '').split(',').filter(Boolean));
  if (off.has('shadows')) renderer.shadowMap.enabled = false;
  for (const name of ['terrain', 'trees', 'doodads', 'buildings', 'water', 'sky']) {
    const o = world.root.getObjectByName(name);
    if (o && off.has(name)) o.visible = false;
  }
  if (off.has('glow')) world.root.traverse((o) => o.name === 'glow' && (o.visible = false));

  const units: DemoUnit[] = [];
  if (params.get('units') !== '0' && !off.has('units')) {
    if (isShowcase) showcaseUnits(world, anim, units);
    else demoUnitsForView(map, world, view as MapViewName, anim, units);
  }

  // --- Camera preset ----------------------------------------------------------
  const preset = isShowcase ? showcaseView(view as ShowcaseView) : computeView(map, view as MapViewName, world.heightAt);
  toThree(preset.position.x, preset.position.y, preset.position.z, camera.position);
  const tgt = toThree(preset.target.x, preset.target.y, preset.target.z);
  const dir = tgt.clone().sub(camera.position).normalize();
  let yaw = Math.atan2(-dir.x, -dir.z);
  let pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const applyLook = (): void => {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  };
  applyLook();

  // --- Free-fly controls ----------------------------------------------------------
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent): void => {
    keys.add(e.code);
    if (e.code === 'KeyG') {
      const p: Vec3 = fromThree(camera.position);
      const eye = eyeAt(map, world.heightAt, p.x, p.y);
      camera.position.y = eye.z;
    }
    if (e.code === 'KeyT') world.setTimeOfDay(world.timeOfDay + 1 / 12);
    if (e.code === 'KeyU') units.forEach((u) => u.model.play(ANIMS[(ANIMS.indexOf(u.model.current) + 1) % ANIMS.length]!));
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  let dragging = false;
  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    yaw -= e.movementX * 0.0035;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0035));
    applyLook();
  };
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('resize', onResize);

  // --- Overlay ------------------------------------------------------------------
  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:#000a;color:#dfe;font:12px/1.35 monospace;pointer-events:none';
  ui.appendChild(overlay);

  const fwd = new Vector3();
  const right = new Vector3();
  const move = new Vector3();
  let frames = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;
  // Rolling averages: frame interval and CPU time spent in update + render submission.
  let frameMs = 0;
  let cpuMs = 0;
  let last = performance.now();

  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Movement in look direction.
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0);
    if (keys.has('KeyW')) move.add(fwd);
    if (keys.has('KeyS')) move.sub(fwd);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (keys.has('Space')) move.y += 1;
    if (keys.has('KeyC')) move.y -= 1;
    if (move.lengthSq() > 0) {
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2600 : 650;
      camera.position.addScaledVector(move.normalize(), speed * dt);
    }
    const c0 = performance.now();
    for (const u of units) u.model.update(dt);
    world.update(dt, camera.position);
    renderer.render(scene, camera);
    cpuMs += (performance.now() - c0 - cpuMs) * 0.05;
    frameMs += (dt * 1000 - frameMs) * 0.05;

    frames++;
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    if (frames % 15 === 1) {
      const s = world.getStats();
      const p = fromThree(camera.position);
      window.__worldStats = { ...s, fps, view, frameMs, cpuMs };
      const hour = world.timeOfDay * 24;
      overlay.textContent =
        `world · ${map.data.source} · view ${view}\n` +
        `fps ${fps.toFixed(0)} (${frameMs.toFixed(1)} ms, cpu ${cpuMs.toFixed(1)} ms)  calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
        `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} (eye ${(p.z - world.heightAt(p.x, p.y)).toFixed(0)})\n` +
        `time ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}  trees ${s.trees}  buildings ${s.buildings}\n` +
        `WASD fly · drag look · Shift fast · Space/C up/down · G eye height (${EYE_HEIGHT}) · T time · U anim`;
    }
    if (frames === 2) markSceneReady();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
