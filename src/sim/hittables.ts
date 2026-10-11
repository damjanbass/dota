// Hittables for the player's hitscan: living enemies and neutrals (invisible ones only while revealed) plus
// allied creeps / towers that can be denied right now. Shapes come from the player's hitboxFor().
import type { SimApi, UnitState } from '../core/sim';
import type { Hittable, Team, UnitKind } from '../core/types';
import { hitboxFor } from '../player/hitbox';
import type { HitboxShape } from '../player/hitbox';
import { DENY_THRESHOLD } from './combat';

const BUILDING_KINDS: ReadonlySet<UnitKind> = new Set<UnitKind>(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'fountain', 'building']);
const shapeCache = new Map<string, HitboxShape>();

/**
 * Hitbox for a unit def. Buildings get a body radius slightly larger than their collision radius so the unit's
 * capsule is entered before a building collider of the same radius that blocks shots.
 */
export const hitShape = (u: UnitState): HitboxShape => {
  let s = shapeCache.get(u.def.id);
  if (!s) {
    const base = hitboxFor({ collisionRadius: u.def.collisionRadius, height: u.def.height });
    s = BUILDING_KINDS.has(u.kind)
      ? { ...base, bodyRadius: u.def.collisionRadius + 2, bodyHeight: Math.max(base.bodyHeight, u.def.height - base.headRadius * 2) }
      : base;
    shapeCache.set(u.def.id, s);
  }
  return s;
};

const isDeniableState = (u: UnitState): boolean => {
  if (u.kind === 'creep_melee' || u.kind === 'creep_ranged' || u.kind === 'creep_siege') return u.hp < u.maxHp * DENY_THRESHOLD.creep;
  if (u.kind === 'tower') return u.hp < u.maxHp * DENY_THRESHOLD.tower;
  return false;
};

/** Living units `viewerTeam`'s player can shoot. The player's own hero is excluded. */
export const hittablesFor = (sim: SimApi, viewerTeam: Team): Hittable[] => {
  const out: Hittable[] = [];
  const self = sim.player();
  for (const u of sim.units()) {
    if (!u.alive || u === self) continue;
    if (u.team === viewerTeam) {
      if (!isDeniableState(u)) continue;
    } else if (u.buffs.some((b) => b.invisible) && !sim.isVisibleTo(viewerTeam, u.id)) {
      continue;
    }
    const s = hitShape(u);
    out.push({ id: u.id, team: u.team, position: u.position, bodyRadius: s.bodyRadius, bodyHeight: s.bodyHeight, headRadius: s.headRadius, alive: true });
  }
  return out;
};
