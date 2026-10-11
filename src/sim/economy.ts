// Gold (reliable / unreliable), last-hit bounties, XP sharing and deny XP (6.83d tables).
import { scaledRange } from '../core/config';
import type { Team } from '../core/types';
import { CREEP_XP, DENY, ITEMS, NEUTRAL_CAMPS } from '../data';
import { addXp } from './heroes';
import type { SimUnit } from './types';
import type { World } from './world';

export const totalGold = (u: SimUnit): number => (u.hero ? u.hero.reliableGold + u.hero.unreliableGold : 0);

/** Adds gold (floored to whole gold). Unreliable income is blocked for a while after a buyback. */
export const giveGold = (w: World, u: SimUnit, amount: number, reliable: boolean, reason: string): void => {
  const h = u.hero;
  const a = Math.floor(amount);
  if (!h || a <= 0) return;
  if (!reliable && w.time < h.unreliableBlockedUntil) return;
  if (reliable) h.reliableGold += a;
  else h.unreliableGold += a;
  w.events.emit('gold:changed', { unitId: u.id, gold: totalGold(u), delta: a, reason });
};

/** Spends unreliable gold first, then reliable. Returns false (and spends nothing) if not enough. */
export const spendGold = (w: World, u: SimUnit, cost: number, reason: string): boolean => {
  const h = u.hero;
  if (!h || totalGold(u) < cost) return false;
  if (cost <= 0) return true;
  const fromUnreliable = Math.min(h.unreliableGold, cost);
  h.unreliableGold -= fromUnreliable;
  h.reliableGold -= cost - fromUnreliable;
  w.events.emit('gold:changed', { unitId: u.id, gold: totalGold(u), delta: -cost, reason });
  return true;
};

/** Death gold loss: taken only from unreliable gold. */
export const loseUnreliable = (w: World, u: SimUnit, amount: number, reason: string): void => {
  const h = u.hero;
  if (!h) return;
  const a = Math.min(h.unreliableGold, Math.floor(amount));
  if (a <= 0) return;
  h.unreliableGold -= a;
  w.events.emit('gold:changed', { unitId: u.id, gold: totalGold(u), delta: -a, reason });
};

export const passiveGold = (w: World): void => {
  for (const h of w.heroes) giveGold(w, h, 1, false, 'passive');
};

export const netWorth = (u: SimUnit): number => {
  let n = totalGold(u);
  for (const id of u.hero?.items ?? []) if (id) n += ITEMS[id]?.cost ?? 0;
  return n;
};

/** Alive heroes within `radius` of (x, y), optionally filtered by team. */
export const heroesNear = (w: World, x: number, y: number, radius: number, team?: Team): SimUnit[] => {
  const out: SimUnit[] = [];
  const r2 = radius * radius;
  for (const h of w.heroes) {
    if (!h.alive || (team !== undefined && h.team !== team)) continue;
    const dx = h.position.x - x;
    const dy = h.position.y - y;
    if (dx * dx + dy * dy <= r2) out.push(h);
  }
  return out;
};

export const xpShareRadius = (): number => scaledRange(CREEP_XP.shareRadius + CREEP_XP.shareRadiusFudge);

const ANCIENT_NEUTRALS: ReadonlySet<string> = new Set(NEUTRAL_CAMPS.ancient.groups.flat());

/** Bounty + XP for a dying non-hero unit (creep, neutral, building, Roshan). */
export const rewardUnitKill = (w: World, victim: SimUnit, killer: SimUnit | null, denied: boolean): void => {
  const killerHero = killer?.hero ? killer : null;
  if (denied) {
    if (killerHero) killerHero.hero!.denies++;
    const isCreep = victim.kind === 'creep_melee' || victim.kind === 'creep_ranged' || victim.kind === 'creep_siege';
    if (!isCreep) return;
    // Enemy heroes near a denied creep still get a small XP pool (31 melee / 20 ranged, split by count).
    const enemies = w.heroes.filter((h) => h.alive && h.team !== victim.team && h.team !== 'neutral');
    const near = enemies.filter((h) => {
      const dx = h.position.x - victim.position.x;
      const dy = h.position.y - victim.position.y;
      return dx * dx + dy * dy <= scaledRange(DENY.radius + CREEP_XP.shareRadiusFudge) ** 2;
    });
    for (const h of near) addXp(w, h, (h.ranged ? DENY.xpPoolRangedHero : DENY.xpPoolMeleeHero) / near.length);
    return;
  }
  if (!killer || killer.team === victim.team || killer.team === 'neutral') return;

  if (killerHero && victim.def.bountyGoldMax > 0) {
    const gold = w.rng.int(victim.def.bountyGoldMin, victim.def.bountyGoldMax);
    giveGold(w, killerHero, gold, false, 'lasthit');
  }
  if (killerHero && !victim.isBuilding) killerHero.hero!.lastHits++;

  const xp = victim.def.bountyXp;
  if (xp <= 0) return;
  const anyTeam = victim.team === 'neutral' && victim.kind === 'neutral' && !ANCIENT_NEUTRALS.has(victim.def.id);
  let near = heroesNear(w, victim.position.x, victim.position.y, xpShareRadius()).filter((h) => (anyTeam ? true : h.team !== victim.team));
  if (!anyTeam) near = near.filter((h) => h.team === killer.team || victim.team !== 'neutral');
  if (near.length === 0) return;
  for (const h of near) addXp(w, h, xp / near.length);
};
