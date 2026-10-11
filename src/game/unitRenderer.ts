// Renders sim units (creeps, neutrals, Roshan, bot heroes) with the world's unit models:
// render-interpolated positions, sim-driven animations, fog of war for enemies, corpses that linger.
// Buildings are rendered by the world (static models) and the player's own hero is never drawn.
import type { Scene } from 'three';
import { facingToThreeYaw, toThree } from '../core/coords';
import type { EventBus } from '../core/events';
import type { SimApi, UnitState } from '../core/sim';
import type { GameEvents, Team, UnitKind } from '../core/types';
import { createUnitModel } from '../world';
import type { AnimName, AnimatedModel } from '../world';
import { modelIdFor, tierScale } from './unitModels';

const STATIC_KINDS: ReadonlySet<UnitKind> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);
/** Seconds a dead non-hero unit stays (death animation + sink) before its model is disposed. */
const CORPSE_TIME = 5;

interface Entry {
  model: AnimatedModel;
  diedAt: number | null;
}

export interface UnitRenderer {
  update(alpha: number, frameDt: number): void;
  dispose(): void;
}

const toAnim = (a: UnitState['anim']): AnimName => (a === 'cast' ? 'attack' : a);

export const createUnitRenderer = (opts: {
  scene: Scene;
  sim: SimApi;
  events: EventBus<GameEvents>;
  viewerTeam: Team;
  heightAt: (x: number, y: number) => number;
}): UnitRenderer => {
  const { scene, sim, events, viewerTeam, heightAt } = opts;
  const entries = new Map<number, Entry>();

  const create = (u: UnitState): Entry | null => {
    const id = modelIdFor(u.def.id);
    if (!id) return null;
    const model = createUnitModel(id, { height: u.def.height * tierScale(u.def.id) });
    scene.add(model.object3D);
    const entry: Entry = { model, diedAt: null };
    entries.set(u.id, entry);
    return entry;
  };

  const remove = (unitId: number, entry: Entry): void => {
    scene.remove(entry.model.object3D);
    entry.model.dispose();
    entries.delete(unitId);
  };

  const offAttack = events.on('unit:attack', ({ sourceId }) => {
    entries.get(sourceId)?.model.play('attack', { restart: true });
  });

  const live = new Set<number>();
  return {
    update(alpha, frameDt) {
      live.clear();
      for (const u of sim.units()) {
        if (STATIC_KINDS.has(u.kind) || u.hero?.isPlayer) continue;
        const entry = entries.get(u.id) ?? create(u);
        if (!entry) continue;
        live.add(u.id);
        const obj = entry.model.object3D;

        if (!u.alive) {
          if (entry.diedAt === null) {
            entry.diedAt = sim.time;
            entry.model.play('death');
          }
          if (sim.time - entry.diedAt > CORPSE_TIME) {
            // Heroes keep their model for respawn; everything else is gone for good.
            if (u.hero) obj.visible = false;
            else remove(u.id, entry);
            continue;
          }
        } else if (entry.diedAt !== null) {
          entry.diedAt = null; // respawned hero
          entry.model.play('idle', { restart: true });
        }

        obj.visible = u.team === viewerTeam || sim.isVisibleTo(viewerTeam, u.id);
        if (!obj.visible) continue;
        const x = u.prevPosition.x + (u.position.x - u.prevPosition.x) * alpha;
        const y = u.prevPosition.y + (u.position.y - u.prevPosition.y) * alpha;
        toThree(x, y, heightAt(x, y), obj.position);
        obj.rotation.y = facingToThreeYaw(u.facing);
        if (u.alive) {
          const anim = toAnim(u.anim);
          // 'attack' is restarted per swing by the unit:attack event; don't fight it here.
          if (anim !== entry.model.current && anim !== 'attack') entry.model.play(anim);
        }
        entry.model.update(frameDt);
      }
      for (const [id, entry] of entries) if (!live.has(id)) remove(id, entry);
    },
    dispose() {
      offAttack();
      for (const [id, entry] of entries) remove(id, entry);
    },
  };
};
