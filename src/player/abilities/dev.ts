// ?scene=kit — Sniper kit playground: C's FPS player on the map (agent D's world, or ?world=dev for C's fast debug
// terrain), a sim (FakeSim until agent E's lands), enemy heroes / creeps down the mid lane and a debug readout.
//   ?map=mock   ?world=dev   ?level=16   ?fresh=1 (no skills learned)   ?tp=3   ?confirm=1 (click-to-confirm Q)
//   ?shadows=0  ?dpr=1   ?test=1 (window.__kit / __kitDev / __player hooks)
// Keys: Q Shrapnel · R Assassinate · F Town Portal · Ctrl+Q/E/R/G level skills · Backslash refresh mana/cooldowns.
import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  WebGLRenderer,
} from 'three';
import { VIEW_DISTANCE } from '../../core/config';
import { facingToThreeYaw, toThree } from '../../core/coords';
import { groundHeightAt } from '../../core/map';
import type { LoadedMap, MapEntity } from '../../core/map';
import { createMockMap } from '../../core/mockMap';
import { startLoop } from '../../core/loop';
import { markSceneReady } from '../../core/scene';
import type { SceneRunner } from '../../core/scene';
import type { UnitState } from '../../core/sim';
import type { Hittable, Team, Tier, Vec2 } from '../../core/types';
import { createBuildingColliders } from '../../game/buildingColliders';
import { createUnitModel, createWorld } from '../../world';
import type { AnimatedModel } from '../../world';
import { createDevBuildings, createDevTerrain } from '../devTerrain';
import { TreeGrid, headCenterZ, hitboxFor } from '../hitbox';
import { createPlayer, findSpawn } from '../index';
import type { ObstacleProvider } from '../controller';
import { ASSASSINATE, HEADSHOT, SHRAPNEL, TAKE_AIM, TOWN_PORTAL, TP_ITEM, hasBuffFlag, isBuilding } from './ids';
import { createSniperKit } from './kit';
import { registerSniperAbilities } from './register';
import { FakeSim } from './testing/fakeSim';
import type { ChargeTimers } from './testing/fakeSim';

interface DevUnitInfo {
  id: number;
  name: string;
  team: Team;
  kind: string;
  x: number;
  y: number;
  z: number;
  chestZ: number;
  headZ: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

declare global {
  interface Window {
    __kitDev?: {
      units(): DevUnitInfo[];
      heroId: number;
      anchors(): Array<{ name: string; x: number; y: number }>;
      refresh(): void;
      events: string[];
    };
  }
}

const BUILDING_DEFS: Record<string, (e: MapEntity) => string | null> = {
  tower: (e) => `${e.team}_tower_t${e.tier ?? 1}`,
  barracks_melee: (e) => `${e.team}_barracks_melee`,
  barracks_ranged: (e) => `${e.team}_barracks_ranged`,
  ancient: (e) => `${e.team}_ancient`,
  fountain: (e) => `${e.team}_fountain`,
};

/** Range lane: the Sentinel mid T1 looking at the Scourge mid T1 (else the hero spawn looking at the map centre). */
const rangeLayout = (map: LoadedMap): { x: number; y: number; yaw: number } => {
  const s1 = map.data.entities.find((e) => e.kind === 'tower' && e.team === 'sentinel' && e.lane === 'mid' && e.tier === 1);
  const u1 = map.data.entities.find((e) => e.kind === 'tower' && e.team === 'scourge' && e.lane === 'mid' && e.tier === 1);
  if (s1 && u1) {
    const yaw = Math.atan2(u1.y - s1.y, u1.x - s1.x);
    return { x: s1.x + Math.cos(yaw) * 320 + Math.sin(yaw) * 60, y: s1.y + Math.sin(yaw) * 320 - Math.cos(yaw) * 60, yaw };
  }
  return findSpawn(map);
};

interface DevUnitView {
  model: AnimatedModel;
  hpBack: Sprite;
  hpFill: Sprite;
  group: Group;
}

export const run: SceneRunner = ({ canvas, ui, map: loadedMap }) => {
  const params = new URLSearchParams(location.search);
  const testMode = params.get('test') === '1';
  const map = params.get('map') === 'mock' ? createMockMap() : loadedMap;
  const devWorld = params.get('world') === 'dev';

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(Number(params.get('dpr') ?? window.devicePixelRatio), 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new Scene();
  const camera = new PerspectiveCamera(74, window.innerWidth / window.innerHeight, 4, VIEW_DISTANCE);

  // --- world --------------------------------------------------------------------------------------
  let heightAt = (x: number, y: number): number => groundHeightAt(map, x, y);
  let worldUpdate: (dt: number) => void = () => {};
  const disposers: Array<() => void> = [];
  if (devWorld) {
    const sky = new Color(0x9cb9d4);
    scene.background = sky;
    scene.fog = new Fog(sky, 3500, 15000);
    scene.add(new HemisphereLight(0xd6e6ff, 0x5a4a32, 1.3));
    const sun = new DirectionalLight(0xfff0d6, 2.6);
    sun.position.set(0.5, 1, 0.35);
    scene.add(sun);
    const terrain = createDevTerrain(map);
    const buildings = createDevBuildings(map);
    scene.add(terrain.group, buildings.group);
    disposers.push(terrain.dispose, buildings.dispose);
  } else {
    const world = createWorld({ scene, renderer, map, timeOfDay: 0.42, shadows: params.get('shadows') !== '0' });
    heightAt = world.heightAt;
    worldUpdate = (dt) => world.update(dt, camera.position);
    disposers.push(world.dispose);
  }
  const colliders = createBuildingColliders(map);
  const trees = new TreeGrid(map.data.trees);

  // --- sim + units --------------------------------------------------------------------------------
  const sim = new FakeSim({ map, seed: 1234 });
  registerSniperAbilities(sim);
  const events = sim.events;
  for (const e of map.data.entities) {
    const defId = BUILDING_DEFS[e.kind]?.(e);
    if (defId && (e.team === 'sentinel' || e.team === 'scourge')) sim.spawn(defId, e.team, e.x, e.y, { lane: e.lane, tier: e.tier as Tier | undefined, entityId: e.id });
  }
  const layout = rangeLayout(map);
  const level = Number(params.get('level') ?? 16);
  const hero = sim.spawnHero('sniper', 'sentinel', layout.x, layout.y, { level, isPlayer: true });
  if (params.get('fresh') !== '1') {
    for (const id of [SHRAPNEL, HEADSHOT, TAKE_AIM, ASSASSINATE]) while (sim.learnAbility(hero.id, id));
  }
  for (let i = 0; i < Number(params.get('tp') ?? 3); i++) sim.addItem(hero.id, TP_ITEM);

  const fx = Math.cos(layout.yaw);
  const fy = Math.sin(layout.yaw);
  const at = (d: number, side: number): Vec2 => ({ x: layout.x + fx * d + fy * side, y: layout.y + fy * d - fx * side });
  interface Dummy {
    unit: UnitState;
    home: Vec2;
    strafe: number;
    phase: number;
    diedAt: number;
  }
  const dummies: Dummy[] = [];
  const HERO_IDS = new Set(['pudge', 'lion', 'viper', 'lich', 'shadow_fiend']);
  const addDummy = (defId: string, d: number, side: number, strafe = 0): void => {
    const p = at(d, side);
    const unit = HERO_IDS.has(defId) ? sim.spawnHero(defId, 'scourge', p.x, p.y, { level: 12 }) : sim.spawn(defId, 'scourge', p.x, p.y);
    unit.facing = layout.yaw + Math.PI;
    dummies.push({ unit, home: p, strafe, phase: 0, diedAt: Number.NaN });
  };
  addDummy('pudge', 900, -120);
  addDummy('lion', 1500, 40, 220);
  addDummy('viper', 2300, 160);
  addDummy('scourge_creep_melee', 1150, -330);
  addDummy('scourge_creep_melee', 1210, -400);
  addDummy('scourge_creep_ranged', 1290, -340);

  const unitHittables = new Map<number, Hittable>();
  const hittables = (): Iterable<Hittable> => {
    const out: Hittable[] = [];
    for (const u of sim.units()) {
      if (isBuilding(u.kind)) continue;
      let h = unitHittables.get(u.id);
      if (!h) {
        h = { id: u.id, team: u.team, position: u.position, alive: u.alive, ...hitboxFor({ collisionRadius: u.def.collisionRadius, height: u.def.height }) };
        unitHittables.set(u.id, h);
      }
      h.alive = u.alive;
      out.push(h);
    }
    return out;
  };
  const obstacles: ObstacleProvider = {
    obstaclesNear: (x, y, r) => colliders.obstaclesNear(x, y, r),
  };

  // --- player + kit ---------------------------------------------------------------------------------
  const player = createPlayer({
    map,
    camera,
    scene,
    events,
    ui,
    pointerLockTarget: canvas,
    obstacles,
    targets: hittables,
    buildings: () => colliders.blockers,
    trees,
    spawn: { x: layout.x, y: layout.y, yaw: layout.yaw },
    shooterId: hero.id,
    testMode,
  });
  player.resize(window.innerWidth, window.innerHeight);
  const kit = createSniperKit({ sim, player, scene, camera, ui, events, map, heightAt, options: { clickToConfirm: params.get('confirm') === '1' } });

  // The rifle hits through the sim (Headshot procs inside dealDamage(isAttack)).
  events.on('player:shot', ({ result }) => {
    if (result.targetId !== null) sim.attack(hero.id, result.targetId, { headshot: result.part === 'head' });
  });

  // --- unit views -------------------------------------------------------------------------------------
  const views = new Map<number, DevUnitView>();
  const hpBackMat = new SpriteMaterial({ color: 0x000000, depthWrite: false, transparent: true, opacity: 0.7 });
  const hpFillMat = new SpriteMaterial({ color: 0xd03020, depthWrite: false });
  for (const d of dummies) {
    const u = d.unit;
    const model = createUnitModel(u.def.id, { height: u.def.height });
    const group = new Group();
    group.add(model.object3D);
    const hpBack = new Sprite(hpBackMat);
    const hpFill = new Sprite(hpFillMat);
    hpFill.renderOrder = 1;
    hpBack.position.set(0, u.def.height + 30, 0);
    hpFill.position.set(0, u.def.height + 30, 0);
    hpBack.scale.set(80, 9, 1);
    group.add(hpBack, hpFill);
    scene.add(group);
    views.set(u.id, { model, hpBack, hpFill, group });
    disposers.push(() => model.dispose());
  }
  disposers.push(() => {
    hpBackMat.dispose();
    hpFillMat.dispose();
  });

  // --- HUD ----------------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .kd-hud { position: absolute; left: 8px; top: 8px; margin: 0; padding: 8px 10px; background: rgba(0,0,0,0.55);
      font: 12px/1.45 Consolas, monospace; color: #dfe; white-space: pre; }
    .kd-hint { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); font: 12px Verdana, sans-serif;
      color: #fff; text-shadow: 0 1px 2px #000; opacity: 0.85; white-space: nowrap; }
    .kd-click { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); padding: 14px 22px;
      background: rgba(0,0,0,0.6); border: 1px solid #c9a03a; color: #ffd84a; font: bold 18px Verdana, sans-serif; }
    .kd-hs { position: absolute; left: 50%; top: 30%; transform: translate(-50%, 0); opacity: 0;
      font: bold 30px Verdana, sans-serif; color: #ff3a2a; letter-spacing: 3px; text-shadow: 0 2px 4px #000, 0 0 12px #f80; }
    .kd-hs.show { animation: kd-hs 1s ease-out forwards; }
    @keyframes kd-hs { 0% { opacity: 0; transform: translate(-50%, 10px) scale(1.4); } 12% { opacity: 1; transform: translate(-50%, 0) scale(1); }
      70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -20px); } }
  `;
  document.head.appendChild(style);
  const hud = document.createElement('pre');
  hud.className = 'kd-hud';
  const hint = document.createElement('div');
  hint.className = 'kd-hint';
  hint.textContent = 'Q Shrapnel · R Assassinate (hold on a hero) · F Town Portal · RMB/E scope = Take Aim · Ctrl+Q/E/R/G level · \\ refresh';
  const click = document.createElement('div');
  click.className = 'kd-click';
  click.textContent = 'Click to play';
  const hs = document.createElement('div');
  hs.className = 'kd-hs';
  hs.textContent = 'HEADSHOT';
  ui.append(hud, hint, click, hs);
  disposers.push(() => style.remove());

  const log: string[] = [];
  const pushLog = (s: string): void => {
    log.push(s);
    if (log.length > 6) log.shift();
  };
  events.on('unit:damaged', (e) => {
    const t = sim.get(e.targetId);
    if (!t) return;
    const last = sim.damageLog.at(-1);
    const what = last?.abilityId ? last.abilityId.replace('sniper_', '') : 'rifle';
    pushLog(`${t.def.name.padEnd(10)} -${e.amount.toFixed(0).padStart(3)} ${what}${e.headshot ? ' HEADSHOT' : ''}`);
    if (e.headshot && e.sourceId === hero.id) {
      hs.classList.remove('show');
      void hs.offsetWidth;
      hs.classList.add('show');
    }
  });
  events.on('unit:died', (e) => pushLog(`${sim.get(e.unitId)?.def.name ?? '?'} died`));

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Backslash') sim.refresh(hero.id);
  };
  window.addEventListener('keydown', onKey);
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    player.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  disposers.push(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  });

  if (testMode) {
    window.__kitDev = {
      heroId: hero.id,
      events: log,
      units: () =>
        sim.units().map((u) => {
          const hb = hitboxFor({ collisionRadius: u.def.collisionRadius, height: u.def.height });
          return {
            id: u.id,
            name: u.def.name,
            team: u.team,
            kind: u.kind,
            x: u.position.x,
            y: u.position.y,
            z: u.position.z,
            chestZ: u.position.z + hb.bodyHeight * 0.6,
            headZ: headCenterZ({ ...hb, id: u.id, team: u.team, position: u.position, alive: u.alive }),
            hp: u.hp,
            maxHp: u.maxHp,
            alive: u.alive,
          };
        }),
      anchors: () => sim.units().filter((u) => u.team === 'sentinel' && isBuilding(u.kind) && u.alive).map((u) => ({ name: `${u.kind}:${u.lane ?? ''}:${u.tier ?? ''}`, x: u.position.x, y: u.position.y })),
      refresh: () => sim.refresh(hero.id),
    };
  }

  // --- loop ----------------------------------------------------------------------------------------------
  let ready = false;
  let hudTimer = 0;
  let frames = 0;
  let fps = 0;
  let fpsTimer = 0;
  const now = (): number => sim.time;

  startLoop({
    update: (dt) => {
      const st = sim.stats(hero.id);
      player.stats.moveSpeed = st.moveSpeed;
      player.stats.fireInterval = st.attackCooldown;
      player.stunned = hasBuffFlag(hero, 'stunned', now());
      player.update(dt);
      kit.update(dt);
      sim.setUnitPosition(hero.id, player.controller.position, player.controller.yaw);
      for (const d of dummies) {
        const u = d.unit;
        if (!u.alive) {
          if (Number.isNaN(d.diedAt)) d.diedAt = now();
          else if (now() - d.diedAt > 4) {
            sim.revive(u.id);
            sim.teleport(u.id, d.home.x, d.home.y);
            d.diedAt = Number.NaN;
          }
          continue;
        }
        if (d.strafe > 0 && !hasBuffFlag(u, 'stunned', now())) {
          // Strafe at the unit's live move speed so slows show.
          const speed = sim.stats(u.id).moveSpeed;
          d.phase += (speed * dt) / d.strafe;
          const s = Math.sin(d.phase) * d.strafe;
          const x = d.home.x - fy * s;
          const y = d.home.y + fx * s;
          sim.setUnitPosition(u.id, { x, y, z: groundHeightAt(map, x, y) }, Math.cos(d.phase) >= 0 ? layout.yaw + Math.PI / 2 : layout.yaw - Math.PI / 2);
        }
      }
      sim.step(dt);
    },
    render: (alpha, frameDt) => {
      player.render(alpha, frameDt);
      kit.render(frameDt);
      worldUpdate(frameDt);
      for (const d of dummies) {
        const u = d.unit;
        const v = views.get(u.id)!;
        const x = u.prevPosition.x + (u.position.x - u.prevPosition.x) * alpha;
        const y = u.prevPosition.y + (u.position.y - u.prevPosition.y) * alpha;
        toThree(x, y, heightAt(x, y), v.group.position);
        v.model.object3D.rotation.y = facingToThreeYaw(u.facing);
        const moving = Math.hypot(u.position.x - u.prevPosition.x, u.position.y - u.prevPosition.y) > 0.5;
        const anim = !u.alive ? 'death' : moving ? 'walk' : 'idle';
        if (v.model.current !== anim) v.model.play(anim);
        v.model.update(frameDt);
        v.hpBack.visible = v.hpFill.visible = u.alive;
        v.hpFill.scale.set(78 * Math.max(0, u.hp / u.maxHp), 7, 1);
      }
      renderer.render(scene, camera);
      player.renderOverlay(renderer);
      click.style.display = testMode || player.input.locked || kit.logic.tpOverlayOpen ? 'none' : 'block';

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
        const h = hero.hero!;
        const cd = (id: string): string => {
          const left = (h.cooldownReadyAt[id] ?? 0) - now();
          return left > 0 ? `${left.toFixed(1)}s` : 'ready';
        };
        const restore = (h as typeof h & ChargeTimers).chargeRestoreAt?.[SHRAPNEL];
        const ch = kit.logic.channel();
        const aim = kit.logic.aim;
        hud.textContent = [
          `map     ${map.data.source}  ${devWorld ? 'dev terrain' : 'world'}   fps ${fps.toFixed(0)}   t ${now().toFixed(1)}`,
          `hero    lvl ${h.level}  pts ${h.skillPoints}  hp ${hero.hp.toFixed(0)}/${hero.maxHp.toFixed(0)}  mana ${hero.mana.toFixed(0)}/${hero.maxMana.toFixed(0)}`,
          `skills  Q${h.skillLevels[SHRAPNEL]} G${h.skillLevels[HEADSHOT]} E${h.skillLevels[TAKE_AIM]} R${h.skillLevels[ASSASSINATE]}`,
          `Q       charges ${h.charges[SHRAPNEL] ?? 0}${restore !== undefined ? `  next in ${(restore - now()).toFixed(1)}s` : ''}  fields ${kit.logic.systems.shrapnel.fields.length}`,
          `R       ${cd(ASSASSINATE)}  ${aim.active ? `aim ${kit.logic.aimStatus} ${(aim.progress(kit.logic.assassinateAimTime()) * 100).toFixed(0)}%` : ''}`,
          `F       ${cd(TOWN_PORTAL)}  scrolls ${h.items.filter((i) => i === TP_ITEM).length}  ${ch ? `channel → ${ch.anchor.name}` : kit.logic.tpOverlayOpen ? 'map open' : ''}`,
          `range   ${player.stats.range.toFixed(0)}  ${player.scope.isScoped ? '(scoped: Take Aim)' : ''}  speed ${player.stats.moveSpeed.toFixed(0)}`,
          ...log,
        ].join('\n');
      }

      if (!ready) {
        ready = true;
        markSceneReady();
      }
    },
  });
};
