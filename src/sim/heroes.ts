// Hero lifecycle: XP and levels, hero-kill rewards (bounty, streaks, assists, comeback terms), death gold loss,
// respawn, buyback and the Aegis.
import { scaledRange } from '../core/config';
import type { HeroDef, Team } from '../core/types';
import {
  BUYBACK,
  GOLD,
  HERO_KILL_REWARDS,
  HERO_XP,
  ROSHAN_RULES,
  buybackCost,
  heroKillGold,
  heroKillXp,
  heroLevelFromXp,
  respawnTime,
} from '../data';
import { giveGold, heroesNear, loseUnreliable, netWorth, spendGold } from './economy';
import { TUNABLES } from './tunables';
import type { SimHero, SimUnit } from './types';
import type { World } from './world';

export const makeHeroState = (def: HeroDef, isPlayer: boolean): SimHero => ({
  def,
  level: 1,
  xp: 0,
  skillPoints: 1,
  skillLevels: Object.fromEntries(def.skills.map((s) => [s, 0])),
  cooldownReadyAt: {},
  charges: {},
  reliableGold: 0,
  unreliableGold: GOLD.startingGold,
  items: [null, null, null, null, null, null],
  kills: 0,
  deaths: 0,
  assists: 0,
  lastHits: 0,
  denies: 0,
  respawnAt: null,
  aegis: false,
  isPlayer,
  itemCharges: [0, 0, 0, 0, 0, 0],
  buybackReadyAt: -Infinity,
  respawnPenalty: 0,
  unreliableBlockedUntil: -Infinity,
  streak: 0,
  multiKill: 0,
  lastKillAt: -Infinity,
  chargeRestoreAt: {},
  aegisExpiresAt: Infinity,
  aegisRevive: false,
});

/** Adds XP and processes level-ups (skill point + hero:levelUp per level). */
export const addXp = (w: World, u: SimUnit, amount: number): void => {
  const h = u.hero;
  if (!h || !(amount > 0)) return;
  const maxXp = HERO_XP.totalXpForLevel[HERO_XP.maxLevel - 1]!;
  h.xp = Math.min(maxXp, h.xp + amount);
  const target = heroLevelFromXp(h.xp);
  if (target <= h.level) return;
  while (h.level < target) {
    h.level++;
    h.skillPoints++;
    w.markDirty(u);
    w.unitStats(u);
    w.events.emit('hero:levelUp', { unitId: u.id, level: h.level });
  }
};

const STREAK_TEXT: Record<number, string> = {
  3: 'is on a killing spree!',
  4: 'is dominating!',
  5: 'has a mega kill!',
  6: 'is unstoppable!',
  7: 'is wicked sick!',
  8: 'has a monster kill!',
  9: 'is godlike!',
  10: 'is beyond godlike!',
};
const MULTI_TEXT: Record<number, string> = { 2: 'Double Kill!', 3: 'Triple Kill!', 4: 'Ultra Kill!', 5: 'Rampage!' };

const teamXp = (w: World, team: Team): number => w.heroes.reduce((s, h) => (h.team === team ? s + h.hero!.xp : s), 0);
const teamNetWorth = (w: World, team: Team): number => w.heroes.reduce((s, h) => (h.team === team ? s + netWorth(h) : s), 0);

const announceKill = (w: World, killer: SimUnit, victim: SimUnit): void => {
  const kh = killer.hero!;
  if (!w.firstBloodDone) {
    w.firstBloodDone = true;
    w.announce(`${killer.def.name} has drawn First Blood!`, killer.team);
  }
  kh.multiKill = w.time - kh.lastKillAt <= TUNABLES.multiKillWindow ? kh.multiKill + 1 : 1;
  kh.lastKillAt = w.time;
  const multi = MULTI_TEXT[Math.min(kh.multiKill, 5)];
  if (multi) w.announce(`${killer.def.name}: ${multi}`, killer.team);
  const streak = STREAK_TEXT[Math.min(kh.streak, 10)];
  if (streak) w.announce(`${killer.def.name} ${streak}`, killer.team);
  const vs = victim.hero!.streak;
  if (vs >= 3) w.announce(`${killer.def.name} has ended ${victim.def.name}'s streak`, killer.team);
};

/** Hero death: rewards to the enemy team (bounty, XP, assists), gold loss, streaks, respawn timer. */
export const onHeroDeath = (w: World, victim: SimUnit, killer: SimUnit | null): void => {
  const vh = victim.hero!;
  const level = vh.level;
  const killerTeam = killer && killer.team !== victim.team && killer.team !== 'neutral' ? killer.team : null;

  if (killerTeam && killer) {
    const radius = scaledRange(HERO_KILL_REWARDS.radius + 25);
    const near = heroesNear(w, victim.position.x, victim.position.y, radius, killerTeam);
    if (killer.hero && killer.alive && !near.includes(killer)) near.push(killer);
    const n = Math.min(Math.max(near.length, 1), 5);
    const i = n - 1;

    // Comeback terms (HERO_KILL_REWARDS.comebackTerms).
    const victimTeamXp = teamXp(w, victim.team);
    const killerTeamXp = teamXp(w, killerTeam);
    const xpSum = victimTeamXp + killerTeamXp;
    const K = xpSum > 0 ? Math.max((victimTeamXp - killerTeamXp) / xpSum, 0) * vh.xp : 0;
    const killerNw = teamNetWorth(w, killerTeam);
    const T = killerNw > 0 ? Math.min(Math.max(teamNetWorth(w, victim.team) / killerNw - 1, 0), 1) * netWorth(victim) : 0;

    const baseXp = heroKillXp(level);
    for (const h of near) {
      addXp(w, h, baseXp / near.length + HERO_KILL_REWARDS.xpPerVictimLevel[i]! * level + HERO_KILL_REWARDS.xpComebackFactor[i]! * K);
      const assistGold = HERO_KILL_REWARDS.goldBase[i]! + HERO_KILL_REWARDS.goldPerVictimLevel[i]! * level + HERO_KILL_REWARDS.goldComebackFactor[i]! * T;
      giveGold(w, h, assistGold, true, 'assist');
      if (h !== killer) h.hero!.assists++;
    }

    const bounty = heroKillGold(level, vh.streak);
    if (killer.hero) {
      const kh = killer.hero as SimHero;
      kh.kills++;
      kh.streak++;
      giveGold(w, killer, bounty, true, 'herokill');
      announceKill(w, killer, victim);
    } else {
      // Killed by creeps / towers: the bounty is split among that team's heroes.
      const team = w.teamHeroes(killerTeam);
      for (const h of team) giveGold(w, h, bounty / Math.max(team.length, 1), true, 'herokill');
      if (!w.firstBloodDone) w.firstBloodDone = true;
      w.announce(`${victim.def.name} was killed by the ${killerTeam === 'sentinel' ? 'Sentinel' : 'Scourge'}`, killerTeam);
    }
  }

  vh.deaths++;
  vh.streak = 0;
  vh.multiKill = 0;
  loseUnreliable(w, victim, GOLD.deathGoldLossPerLevel * level, 'death');
  vh.respawnAt = w.time + respawnTime(level) + vh.respawnPenalty;
  vh.respawnPenalty = 0;
};

/** Respawns and Aegis expiry. */
export const tickHeroes = (w: World): void => {
  for (const u of w.heroes) {
    const h = u.hero!;
    if (!u.alive) {
      if (h.respawnAt !== null && w.time >= h.respawnAt) {
        if (h.aegisRevive) {
          h.aegisRevive = false;
          w.reviveHero(u, u.position.x, u.position.y);
        } else {
          const slot = w.teamHeroes(u.team).indexOf(u);
          const p = w.heroSpawnPoint(u.team, slot);
          w.reviveHero(u, p.x, p.y);
        }
      }
      continue;
    }
    if (h.aegis && w.time >= h.aegisExpiresAt) {
      h.aegis = false;
      h.aegisExpiresAt = Infinity;
      w.announce(`The Aegis of the Immortal held by ${u.def.name} has expired`, null);
    }
  }
};

/** Gives the Aegis to `hero` (Roshan kill, simplified pickup). */
export const grantAegis = (w: World, hero: SimUnit): void => {
  const h = hero.hero as SimHero;
  h.aegis = true;
  h.aegisExpiresAt = w.time + ROSHAN_RULES.aegisExpiresAfter;
  w.announce(`${hero.def.name} has acquired the Aegis of the Immortal`, hero.team);
};

export const buybackHero = (w: World, unitId: number): boolean => {
  const u = w.byId.get(unitId);
  const h = u?.hero as SimHero | undefined;
  if (!u || !h || u.alive || h.aegisRevive || h.respawnAt === null) return false;
  if (w.time < h.buybackReadyAt) return false;
  const cost = buybackCost(h.level, w.time);
  if (!spendGold(w, u, cost, 'buyback')) return false;
  const remaining = Math.max(0, h.respawnAt - w.time);
  h.respawnPenalty = remaining * BUYBACK.nextRespawnPenaltyOfRemaining;
  if (BUYBACK.blocksUnreliableGoldUntilNormalRespawn) h.unreliableBlockedUntil = h.respawnAt;
  h.buybackReadyAt = w.time + BUYBACK.cooldown;
  const slot = w.teamHeroes(u.team).indexOf(u);
  const p = w.heroSpawnPoint(u.team, slot);
  w.reviveHero(u, p.x, p.y);
  w.announce(`${u.def.name} has bought back`, u.team);
  return true;
};
