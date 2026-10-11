// ?scene=ui — the full HUD over agent D's world with a fake sim (src/ui/testing/fakeSim.ts) animating:
// a toy mid-lane creep fight, scripted kills, gold, runes, cooldowns and damage numbers. The real
// SniperPlayer walks and shoots (click to lock the mouse). Audio is live after the first click.
//   ?panel=menu|shop|scoreboard|death|end|pause   open a panel for screenshots
//   ?test=1   player test mode (no pointer lock)        ?freeze=1   stop the fake sim clock
// Dev keys: 1 scoreboard · 2 shop · 3 die · 4 victory · 5 defeat · 6 menu · 7 random kill · 8 level up · 9 +500 gold · 0 headshot
import { CapsuleGeometry, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Object3D } from 'three';
import { createAudio } from '../audio';
import { scaledRange, VIEW_DISTANCE } from '../core/config';
import { facingToThreeYaw, toThree } from '../core/coords';
import { startLoop } from '../core/loop';
import { entitiesOfKind } from '../core/map';
import type { LoadedMap } from '../core/map';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';
import type { UnitState } from '../core/sim';
import type { Hittable, Team, Vec2 } from '../core/types';
import { heroStatsAtLevel } from '../data';
import { createPlayer, hitboxFor } from '../player';
import { createUnitModel, createWorld, resolveUnitModelId } from '../world';
import type { AnimatedModel } from '../world';
import { createHud } from './hud';
import { createMenus } from './menus';
import { loadSettings } from './settings';
import { el } from './style';
import { FakeSim } from './testing/fakeSim';

const BUILDINGS = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);

declare global {
  interface Window {
    __ui?: { panel: string | null; sim: FakeSim; ready: boolean };
  }
}

/** Mid-lane spot between the tier-1 towers, plus the direction towards the Scourge. */
const midFront = (map: LoadedMap): { front: Vec2; dir: Vec2 } => {
  const s1 = entitiesOfKind(map, 'tower', 'sentinel').find((e) => e.lane === 'mid' && e.tier === 1);
  const u1 = entitiesOfKind(map, 'tower', 'scourge').find((e) => e.lane === 'mid' && e.tier === 1);
  if (s1 && u1) {
    const dx = u1.x - s1.x;
    const dy = u1.y - s1.y;
    const len = Math.hypot(dx, dy) || 1;
    return { front: { x: s1.x + dx * 0.45, y: s1.y + dy * 0.45 }, dir: { x: dx / len, y: dy / len } };
  }
  const mid = map.data.lanes.mid;
  const a = mid[0]!;
  const b = mid[mid.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { front: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
};

export const run: SceneRunner = ({ canvas, ui, map }) => {
  const params = new URLSearchParams(location.search);
  const panel = params.get('panel');
  const testMode = params.get('test') === '1';
  const settings = loadSettings();

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new Scene();
  const camera = new PerspectiveCamera(74, window.innerWidth / window.innerHeight, 4, VIEW_DISTANCE);
  const world = createWorld({ scene, renderer, map, shadows: false });

  // --- fake match -------------------------------------------------------------------------------------
  const { front, dir } = midFront(map);
  const shopSpot = entitiesOfKind(map, 'shop', 'sentinel')[0];
  const spawn =
    panel === 'shop' && shopSpot
      ? { x: shopSpot.x + 150, y: shopSpot.y - 150, yaw: Math.atan2(dir.y, dir.x) }
      : { x: front.x - dir.x * 900, y: front.y - dir.y * 900, yaw: Math.atan2(dir.y, dir.x) };
  const sim = new FakeSim({ map, demo: true, startTime: 754, playerAt: spawn, front, config: { seed: 7 } });
  const me = sim.player();
  sim.setLevel(me.id, 8);
  const h = me.hero!;
  h.skillPoints = Math.max(h.skillPoints, 1);
  h.items = ['power_treads_agi', 'tpscroll', 'maelstrom', 'tpscroll', 'helm_of_iron_will', null];
  h.unreliableGold = 1210;
  h.reliableGold = 624;
  h.kills = 4;
  h.deaths = 1;
  h.assists = 3;
  h.lastHits = 61;
  h.denies = 9;
  me.hp = me.maxHp * 0.62;
  me.mana = 160;
  h.charges.sniper_shrapnel = 1;
  h.cooldownReadyAt.sniper_shrapnel = sim.time + 23.5;
  h.cooldownReadyAt.sniper_assassinate = sim.time + 7.2;
  h.cooldownReadyAt.item_tpscroll = sim.time + 41;
  for (const u of sim.heroes()) {
    if (u === me || !u.hero) continue;
    sim.setLevel(u.id, u.team === 'scourge' ? 7 + (u.id % 3) : 6 + (u.id % 3));
    u.hero.kills = u.id % 4;
    u.hero.deaths = (u.id + 1) % 3;
    u.hero.lastHits = 20 + ((u.id * 7) % 40);
    u.hero.items = ['tango', 'boots_of_speed', u.id % 2 ? 'ogre_axe' : 'mask_of_death', null, null, null];
    u.hp = u.maxHp * (0.4 + ((u.id * 13) % 50) / 100);
  }
  // Enemy mid hero in sight, at the fight.
  const sf = sim.heroes('scourge')[0];
  if (sf) sim.teleport(sf.id, front.x + dir.x * 420 + dir.y * 140, front.y + dir.y * 420 - dir.x * 140);
  const ally = sim.heroes('sentinel').find((u) => u !== me);
  if (ally) sim.teleport(ally.id, front.x - dir.x * 450 - dir.y * 260, front.y - dir.y * 450 + dir.x * 260);
  if (params.get('freeze') === '1') sim.frozen = true;

  // --- player -----------------------------------------------------------------------------------------
  const hittables = new Map<number, Hittable>();
  const targets = (): Iterable<Hittable> => {
    for (const u of sim.units()) {
      if (u === me || BUILDINGS.has(u.kind)) continue;
      let t = hittables.get(u.id);
      if (!t) {
        t = { id: u.id, team: u.team, position: u.position, alive: u.alive, ...hitboxFor(u.def) };
        hittables.set(u.id, t);
      }
      t.position = u.position;
      t.alive = u.alive;
    }
    return hittables.values();
  };
  const player = createPlayer({
    map,
    camera,
    scene,
    events: sim.events,
    ui,
    pointerLockTarget: canvas,
    spawn,
    testMode,
    shooterId: me.id,
    targets,
    stats: { range: scaledRange(me.def.attackRange + 300), fireInterval: heroStatsAtLevel(h.def, h.level).attackCooldown },
    inputSettings: { sensitivity: settings.sensitivity },
    scopeParams: { fovs: [settings.fov, 40, 10] },
  });
  sim.events.on('player:shot', (e) => {
    if (e.result.targetId === null) return;
    const s = heroStatsAtLevel(h.def, h.level);
    const dmg = s.damageMin + sim.rng.next() * (s.damageMax - s.damageMin);
    sim.dealDamage({ sourceId: me.id, targetId: e.result.targetId, amount: dmg, type: 'physical', isAttack: true, headshot: e.result.part === 'head' });
  });

  // --- HUD, menus, audio --------------------------------------------------------------------------------
  const menus = createMenus(ui);
  let paused = false;
  const hud = createHud({
    root: ui,
    sim,
    player,
    events: sim.events,
    map,
    camera,
    menus,
    onPauseChange: (p) => {
      paused = p;
    },
    onExit: () => {
      void menus.showMainMenu();
    },
  });
  createAudio(sim.events, player, { sim, camera });

  // Seed the kill feed / announcer so the HUD is busy from the first frame.
  const enemies = sim.heroes('scourge');
  const allies = sim.heroes('sentinel').filter((u) => u !== me);
  if (enemies[1]) sim.scriptHeroKill(me.id, enemies[1].id, true);
  if (enemies[2] && allies[1]) sim.scriptHeroKill(allies[1].id, enemies[2].id);
  if (allies[2] && enemies[3]) sim.scriptHeroKill(enemies[3].id, allies[2].id);
  const someCreep = sim.units().find((u) => u.kind === 'creep_melee' && u.team === 'sentinel');
  if (someCreep) {
    someCreep.hp = someCreep.maxHp * 0.3;
  }

  // --- dev controls ----------------------------------------------------------------------------------
  let scorePinned = panel === 'scoreboard';
  const devPanel = el('div');
  devPanel.style.cssText =
    'position:absolute;left:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;max-width:420px;pointer-events:auto;z-index:5;font:11px Verdana;opacity:0.85';
  const devActions: Array<[string, string, () => void]> = [
    ['1', 'Score', () => hud.setScoreboardPinned((scorePinned = !scorePinned))],
    ['2', 'Shop', () => hud.setShopOpen(!hud.shopOpen)],
    ['3', 'Die', () => sim.killPlayer(sf?.id ?? null)],
    ['4', 'Victory', () => sim.endMatch('sentinel')],
    ['5', 'Defeat', () => sim.endMatch('scourge')],
    ['6', 'Menu', () => void menus.showMainMenu()],
    ['7', 'Kill', () => enemies.find((u) => u.alive) && sim.scriptHeroKill(me.id, enemies.find((u) => u.alive)!.id, true)],
    ['8', 'Lvl+', () => sim.addXp(me.id, 1200)],
    ['9', '+500g', () => sim.addGold(me.id, 500, 'dev')],
    ['0', 'HS', () => sf && sim.scriptHit(me.id, sf.id, 105, true)],
  ];
  for (const [key, label, fn] of devActions) {
    const b = el('button', '', `${key} ${label}`);
    b.style.cssText = 'cursor:pointer;background:#1c1810;color:#ffd860;border:1px solid #6b5428;padding:2px 6px;font:11px Verdana';
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', fn);
    devPanel.appendChild(b);
  }
  if (!panel) ui.appendChild(devPanel);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.repeat) return;
    const m = /^Digit(\d)$/.exec(e.code);
    if (!m) return;
    devActions.find(([k]) => k === m[1])?.[2]();
  });

  // --- unit models --------------------------------------------------------------------------------------
  interface View {
    obj: Object3D;
    model: AnimatedModel | null;
    anim: string;
    deadAt: number;
  }
  const views = new Map<number, View>();
  const capsuleGeo = new CapsuleGeometry(18, 60, 3, 8);
  const teamMat: Record<Team, MeshLambertMaterial> = {
    sentinel: new MeshLambertMaterial({ color: 0x6fae5a }),
    scourge: new MeshLambertMaterial({ color: 0xa85a5a }),
    neutral: new MeshLambertMaterial({ color: 0xb8a060 }),
  };
  const viewFor = (u: UnitState): View => {
    let v = views.get(u.id);
    if (v) return v;
    const id = resolveUnitModelId(u.def.id);
    let model: AnimatedModel | null = null;
    let obj: Object3D;
    if (id) {
      model = createUnitModel(id, { height: u.def.height });
      obj = model.object3D;
    } else {
      obj = new Mesh(capsuleGeo, teamMat[u.team]);
      obj.position.y = 48;
    }
    scene.add(obj);
    v = { obj, model, anim: '', deadAt: -1 };
    views.set(u.id, v);
    return v;
  };
  const syncUnits = (alpha: number, dt: number): void => {
    const now = performance.now() / 1000;
    for (const u of sim.units()) {
      if (u === me || BUILDINGS.has(u.kind)) continue;
      if (!u.alive && !views.has(u.id)) continue;
      const v = viewFor(u);
      if (!u.alive) {
        if (v.deadAt < 0) {
          v.deadAt = now;
          v.model?.play('death');
        }
        if (now - v.deadAt > 2.5) {
          scene.remove(v.obj);
          v.model?.dispose();
          views.delete(u.id);
          continue;
        }
      } else if (v.deadAt >= 0) {
        v.deadAt = -1;
        v.anim = '';
      }
      const x = u.prevPosition.x + (u.position.x - u.prevPosition.x) * alpha;
      const y = u.prevPosition.y + (u.position.y - u.prevPosition.y) * alpha;
      toThree(x, y, world.heightAt(x, y), v.obj.position);
      if (!v.model) v.obj.position.y += 48;
      v.obj.rotation.y = facingToThreeYaw(u.facing);
      if (v.model && u.alive && u.anim !== v.anim) {
        v.anim = u.anim;
        v.model.play(u.anim === 'cast' ? 'attack' : u.anim);
      }
      v.model?.update(dt);
    }
  };

  // --- loop -----------------------------------------------------------------------------------------------
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    player.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  player.resize(window.innerWidth, window.innerHeight);

  let frames = 0;
  startLoop({
    update: (dt) => {
      player.update(dt);
      if (paused) return;
      const c = player.controller;
      sim.setUnitPosition(me.id, c.position, c.yaw);
      const input = player.input;
      if (input.pressed('shrapnel')) {
        const tr = player.aimTrace(scaledRange(1800));
        const res = sim.castAbility(me.id, 'sniper_shrapnel', { point: { x: tr.point.x, y: tr.point.y } });
        if (res.ok) sim.events.emit('player:ability', { abilityId: 'sniper_shrapnel', target: tr.point });
      }
      if (input.pressed('assassinate')) {
        const target = enemies.find((u) => u.alive && sim.isVisibleTo('sentinel', u.id));
        if (target) {
          const res = sim.castAbility(me.id, 'sniper_assassinate', { targetId: target.id });
          if (res.ok) {
            sim.events.emit('player:ability', { abilityId: 'sniper_assassinate', targetId: target.id });
            setTimeout(() => {
              sim.events.emit('projectile:launched', { projectileId: 0, sourceId: me.id, targetId: target.id, visual: 'assassinate', speed: 2500 });
              sim.dealDamage({ sourceId: me.id, targetId: target.id, amount: 355, type: 'magical', isAttack: false });
            }, 1700);
          }
        }
      }
      if (input.pressed('townPortal')) {
        const res = sim.castAbility(me.id, 'item_tpscroll', {});
        if (res.ok) sim.events.emit('player:ability', { abilityId: 'item_tpscroll' });
      }
      sim.step(dt);
    },
    render: (alpha, frameDt) => {
      player.render(alpha, frameDt);
      world.setTimeOfDay((0.25 + sim.timeOfDay) % 1);
      world.update(frameDt, camera.position);
      syncUnits(alpha, frameDt);
      renderer.render(scene, camera);
      player.renderOverlay(renderer);
      hud.update(frameDt, alpha);
      frames++;
      if (frames === 3) openPanel();
      if (frames === 6) {
        markSceneReady();
        if (window.__ui) window.__ui.ready = true;
      }
    },
  });

  const openPanel = (): void => {
    window.__ui = { panel, sim, ready: false };
    switch (panel) {
      case 'menu':
        void menus.showMainMenu();
        break;
      case 'shop':
        hud.setShopOpen(true);
        hud.shopSelect('buriza_do_kyanon');
        break;
      case 'scoreboard':
        hud.setScoreboardPinned(true);
        break;
      case 'death':
        sim.killPlayer(sf?.id ?? null);
        break;
      case 'end':
        sim.endMatch('sentinel');
        break;
      case 'pause':
        void menus.showPause();
        break;
      default:
        break;
    }
  };
};
