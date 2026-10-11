// Buildings (6.83d TOWER_RULES): everything starts invulnerable, tier 1 towers open with the first wave, then the
// T1 → T2 → T3 → barracks / T4 / base buildings → Ancient chain. Backdoor protection for T2-T4, barracks and the
// Ancient, team gold for structures, super / mega creeps and the match end.
import type { Lane, Team } from '../core/types';
import { TEAM_GOLD, TOWER_RULES, CREEP_WAVES } from '../data';
import { giveGold, rewardUnitKill } from './economy';
import { TUNABLES } from './tunables';
import { enemyTeam } from './types';
import type { SimUnit } from './types';
import type { World } from './world';

export interface BuildingState {
  t1Open: boolean;
  nextBackdoorAt: number;
  backdoorRegen: number;
}

const teamName = (t: Team): string => (t === 'sentinel' ? 'Sentinel' : t === 'scourge' ? 'Scourge' : 'Neutrals');

const isBackdoorProtected = (u: SimUnit): boolean =>
  (u.kind === 'tower' && (u.tier ?? 1) >= 2) || u.kind === 'barracks_melee' || u.kind === 'barracks_ranged' || u.kind === 'ancient';

const towersOf = (w: World, team: Team, tier: number, lane?: Lane): SimUnit[] =>
  w.unitList.filter((u) => u.kind === 'tower' && u.team === team && u.tier === tier && (lane === undefined || u.lane === lane));

export const initBuildings = (w: World): void => {
  w.buildings = { t1Open: false, nextBackdoorAt: w.time, backdoorRegen: TOWER_RULES.noCreepRegenPerSecond };
  for (const u of w.unitList) {
    if (!u.isBuilding) continue;
    u.baseInvulnerable = true;
    u.bdProtected = isBackdoorProtected(u);
  }
  if (w.time >= CREEP_WAVES.firstWaveAt) openTier1(w);
};

const openTier1 = (w: World): void => {
  w.buildings.t1Open = true;
  for (const u of w.unitList) if (u.kind === 'tower' && u.tier === 1) u.baseInvulnerable = false;
};

const vulnerable = (list: SimUnit[]): void => {
  for (const u of list) u.baseInvulnerable = false;
};

const creepScratch: SimUnit[] = [];

const updateBackdoor = (w: World): void => {
  for (const b of w.unitList) {
    if (!b.alive || !b.isBuilding || !isBackdoorProtected(b)) continue;
    creepScratch.length = 0;
    w.queryInto(b.position.x, b.position.y, TUNABLES.backdoorRadius, creepScratch);
    let creeps = false;
    for (const c of creepScratch) {
      if (c.alive && c.team !== b.team && c.team !== 'neutral' && (c.kind === 'creep_melee' || c.kind === 'creep_ranged' || c.kind === 'creep_siege')) {
        creeps = true;
        break;
      }
    }
    b.bdProtected = !creeps;
  }
  creepScratch.length = 0;
};

export const tickBuildings = (w: World): void => {
  if (!w.buildings.t1Open && w.time >= CREEP_WAVES.firstWaveAt) openTier1(w);
  if (w.time >= w.buildings.nextBackdoorAt) {
    w.buildings.nextBackdoorAt = w.time + TOWER_RULES.creepCheckInterval;
    updateBackdoor(w);
  }
};

const teamGold = (w: World, team: Team, amount: number, reason: string): void => {
  for (const h of w.teamHeroes(team)) giveGold(w, h, amount, true, reason);
};

/** A building died: last-hit bounty, team gold, invulnerability chain, super creeps, match end. */
export const onBuildingDestroyed = (w: World, b: SimUnit, killer: SimUnit | null, denied: boolean): void => {
  w.events.emit('building:destroyed', { unitId: b.id, entityId: b.entityId ?? null });
  rewardUnitKill(w, b, killer, denied);
  const owner = b.team;
  const enemy = enemyTeam(owner);
  const lane = b.lane;

  if (b.kind === 'tower') {
    const tier = b.tier ?? 1;
    if (denied) teamGold(w, enemy, TEAM_GOLD.towerDenied[tier - 1] ?? 0, 'tower');
    else teamGold(w, enemy, TEAM_GOLD.tower[tier - 1] ?? 0, 'tower');
    const where = lane ? `${lane} ` : '';
    w.announce(denied ? `The ${teamName(owner)} denied their tier ${tier} ${where}tower` : `The ${teamName(owner)} tier ${tier} ${where}tower has been destroyed`, enemy);
    if (tier === 1 && lane) vulnerable(towersOf(w, owner, 2, lane));
    else if (tier === 2 && lane) vulnerable(towersOf(w, owner, 3, lane));
    else if (tier === 3 && lane) {
      vulnerable(w.unitList.filter((u) => u.team === owner && u.alive && (u.kind === 'barracks_melee' || u.kind === 'barracks_ranged') && u.lane === lane));
      vulnerable(towersOf(w, owner, 4));
      vulnerable(w.unitList.filter((u) => u.team === owner && u.kind === 'building'));
    } else if (tier === 4) {
      if (towersOf(w, owner, 4).every((t) => !t.alive)) vulnerable(w.unitList.filter((u) => u.team === owner && u.kind === 'ancient'));
    }
    return;
  }

  if (b.kind === 'barracks_melee' || b.kind === 'barracks_ranged') {
    if (!denied) teamGold(w, enemy, b.kind === 'barracks_melee' ? TEAM_GOLD.barracksMelee : TEAM_GOLD.barracksRanged, 'barracks');
    if (lane) {
      if (b.kind === 'barracks_melee') w.waves.superMelee[enemy]![lane] = true;
      else w.waves.superRanged[enemy]![lane] = true;
    }
    const allDead = w.unitList.filter((u) => u.team === owner && (u.kind === 'barracks_melee' || u.kind === 'barracks_ranged')).every((u) => !u.alive);
    if (allDead) {
      w.waves.mega[enemy] = true;
      w.announce(`The ${teamName(enemy)} now spawn Mega Creeps`, enemy);
    }
    w.announce(`The ${teamName(owner)} ${b.kind === 'barracks_melee' ? 'melee' : 'ranged'} barracks in the ${lane ?? ''} lane has been destroyed`, enemy);
    return;
  }

  if (b.kind === 'ancient' && w.winner === null) {
    w.winner = enemy;
    w.announce(`The ${teamName(enemy)} are victorious!`, enemy);
    w.events.emit('match:ended', { winner: enemy });
  }
};
