// Neutral camps (6.83d NEUTRALS / NEUTRAL_CAMPS) and Roshan (ROSHAN_RULES). Camps spawn at 0:30 and on every
// minute after that, only when nothing alive stands in the camp area; groups never repeat twice in a row.
// Roshan respawns 600 s after death, grows every 300 s, and his killer gets the Aegis (simplified pickup).
import { scaledRange } from '../core/config';
import { entitiesOfKind } from '../core/map';
import type { MapEntity } from '../core/map';
import type { Team } from '../core/types';
import { NEUTRALS, NEUTRAL_CAMPS, ROSHAN_RULES, TEAM_GOLD, UNITS } from '../data';
import type { CampType } from '../data';
import { giveGold, heroesNear } from './economy';
import { grantAegis } from './heroes';
import { TUNABLES } from './tunables';
import type { SimUnit } from './types';
import type { World } from './world';

export interface CampState {
  entity: MapEntity;
  type: CampType;
  lastGroup: number;
}

export interface NeutralState {
  enabled: boolean;
  camps: CampState[];
  nextSpawnAt: number;
  roshanSpot: { x: number; y: number } | null;
  roshanId: number;
  roshanRespawnAt: number | null;
  roshanGrowth: number;
}

const CAMP_TYPES: readonly CampType[] = ['small', 'medium', 'large', 'ancient'];

const nextNeutralTime = (t: number): number => {
  if (t <= NEUTRALS.firstSpawnAt) return NEUTRALS.firstSpawnAt;
  return Math.ceil(t / NEUTRALS.interval) * NEUTRALS.interval;
};

export const initNeutrals = (w: World, enabled: boolean): void => {
  const camps: CampState[] = [];
  for (const e of entitiesOfKind(w.map, 'neutral_camp')) {
    const size = String(e.meta?.size ?? 'small') as CampType;
    camps.push({ entity: e, type: CAMP_TYPES.includes(size) ? size : 'small', lastGroup: -1 });
  }
  const rosh = entitiesOfKind(w.map, 'roshan')[0];
  w.neutrals = {
    enabled,
    camps,
    nextSpawnAt: nextNeutralTime(w.time),
    roshanSpot: rosh ? { x: rosh.x, y: rosh.y } : null,
    roshanId: 0,
    roshanRespawnAt: null,
    roshanGrowth: 0,
  };
  if (enabled && rosh) spawnRoshan(w);
};

const growthLevel = (t: number): number => Math.floor(Math.max(0, t) / ROSHAN_RULES.growthInterval);

const spawnRoshan = (w: World): void => {
  const spot = w.neutrals.roshanSpot;
  const def = UNITS.roshan;
  if (!spot || !def) return;
  const g = growthLevel(w.time);
  const u = w.spawnUnit(def, 'neutral', spot.x, spot.y, {
    bonusHp: g * ROSHAN_RULES.growthHpPerLevel,
    bonusDamage: g * ROSHAN_RULES.growthDamagePerLevel,
  });
  u.home = { x: spot.x, y: spot.y };
  w.neutrals.roshanId = u.id;
  w.neutrals.roshanRespawnAt = null;
  w.neutrals.roshanGrowth = g;
};

const blockScratch: SimUnit[] = [];

const campBlocked = (w: World, c: CampState): boolean => {
  blockScratch.length = 0;
  w.queryInto(c.entity.x, c.entity.y, TUNABLES.neutralCampRadius, blockScratch);
  const blocked = blockScratch.some((u) => u.alive && !u.isBuilding);
  blockScratch.length = 0;
  return blocked;
};

const spawnCamp = (w: World, c: CampState, index: number): void => {
  const groups = NEUTRAL_CAMPS[c.type].groups;
  let g = w.rng.int(0, groups.length - 1);
  if (groups.length > 1 && g === c.lastGroup) g = (g + 1 + w.rng.int(0, groups.length - 2)) % groups.length;
  c.lastGroup = g;
  const group = groups[g]!;
  group.forEach((defId, i) => {
    const def = UNITS[defId];
    if (!def) return;
    const a = (i / group.length) * Math.PI * 2 + c.entity.facing;
    const r = group.length > 1 ? TUNABLES.neutralSpawnSpread : 0;
    const x = c.entity.x + Math.cos(a) * r;
    const y = c.entity.y + Math.sin(a) * r;
    const u = w.spawnUnit(def, 'neutral', x, y, { facing: a + Math.PI });
    u.home = { x, y };
    u.campIndex = index;
  });
};

export const tickNeutrals = (w: World): void => {
  const s = w.neutrals;
  if (!s.enabled) return;
  while (w.time >= s.nextSpawnAt) {
    s.camps.forEach((c, i) => {
      if (!campBlocked(w, c)) spawnCamp(w, c, i);
    });
    s.nextSpawnAt = s.nextSpawnAt < NEUTRALS.interval ? NEUTRALS.interval : s.nextSpawnAt + NEUTRALS.interval;
  }
  if (s.roshanRespawnAt !== null && w.time >= s.roshanRespawnAt) spawnRoshan(w);
  // Growth (+600 HP, +12 damage per 5 minutes) applies to a living Roshan too.
  const rosh = s.roshanId ? w.byId.get(s.roshanId) : undefined;
  if (rosh && rosh.alive) {
    const g = growthLevel(w.time);
    if (g !== s.roshanGrowth) {
      s.roshanGrowth = g;
      rosh.bonusHp = g * ROSHAN_RULES.growthHpPerLevel;
      rosh.bonusDamage = g * ROSHAN_RULES.growthDamagePerLevel;
      w.markDirty(rosh);
      w.unitStats(rosh);
    }
  }
};

const teamName = (t: Team): string => (t === 'sentinel' ? 'Sentinel' : 'Scourge');

/** Roshan death: team gold, Aegis, respawn timer. */
export const onNeutralDeath = (w: World, u: SimUnit, killer: SimUnit | null): void => {
  if (u.kind !== 'roshan') return;
  const s = w.neutrals;
  s.roshanId = 0;
  s.roshanRespawnAt = w.time + ROSHAN_RULES.respawnAfterDeath;
  const team = killer && killer.team !== 'neutral' ? killer.team : null;
  if (!team) return;
  w.announce(`Roshan has been slain by the ${teamName(team)}!`, team);
  for (const h of w.teamHeroes(team)) giveGold(w, h, TEAM_GOLD.roshan, true, 'roshan');
  let holder: SimUnit | null = killer?.hero && killer.alive ? killer : null;
  if (!holder) {
    const near = heroesNear(w, u.position.x, u.position.y, scaledRange(TUNABLES.aegisFallbackRadius), team);
    near.sort((a, b) => Math.hypot(a.position.x - u.position.x, a.position.y - u.position.y) - Math.hypot(b.position.x - u.position.x, b.position.y - u.position.y));
    holder = near[0] ?? null;
  }
  if (holder && !holder.hero!.aegis) grantAegis(w, holder);
};
