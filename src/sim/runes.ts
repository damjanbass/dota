// Runes (6.83d RUNES): at the horn and every 120 s the old runes vanish; one random power rune (never the same type
// twice in a row) and one Bounty rune spawn at the two rune spots (random sides). The first spawn is two Bounty
// runes with the fixed first-spawn reward. A hero within TUNABLES.runePickupRadius picks a rune up.
import { entitiesOfKind, groundHeightAt } from '../core/map';
import { CREEP_WAVES, RUNES, bountyRuneReward } from '../data';
import { giveGold } from './economy';
import { addXp } from './heroes';
import { TUNABLES } from './tunables';
import type { RuneKind, RuneState, SimBuff, SimUnit } from './types';
import type { World } from './world';

export interface RuneSystemState {
  nextAt: number;
  lastPower: RuneKind | null;
  nextRuneId: number;
  spawned: number;
}

export const POWER_RUNES: readonly RuneKind[] = ['haste', 'doubleDamage', 'illusion', 'invisibility', 'regeneration'];

const spawnRunes = (w: World): void => {
  const s = w.runeState;
  w.runeList.length = 0;
  const spots = entitiesOfKind(w.map, 'rune_spot');
  if (spots.length === 0) return;
  const first = s.spawned === 0 && s.nextAt <= RUNES.firstAt;
  const powerSpot = w.rng.int(0, spots.length - 1);
  spots.forEach((spot, i) => {
    let kind: RuneKind = 'bounty';
    if (!first && i === powerSpot) {
      const options = POWER_RUNES.filter((k) => k !== s.lastPower);
      kind = options[w.rng.int(0, options.length - 1)]!;
      s.lastPower = kind;
    }
    const rune: RuneState = { id: s.nextRuneId++, kind, x: spot.x, y: spot.y, z: groundHeightAt(w.map, spot.x, spot.y), spawnedAt: w.time, first };
    w.runeList.push(rune);
    w.events.emit('rune:spawned', { runeId: rune.id, kind, x: rune.x, y: rune.y });
  });
  s.spawned++;
};

const buff = (w: World, u: SimUnit, b: Omit<SimBuff, 'sourceId' | 'expiresAt'>, duration: number): void => {
  w.addBuff(u.id, { ...b, sourceId: u.id, expiresAt: w.time + duration });
};

export const applyRune = (w: World, u: SimUnit, rune: RuneState): void => {
  const p = RUNES.powerRunes;
  switch (rune.kind) {
    case 'haste':
      buff(w, u, { id: 'rune_haste', fixedMoveSpeed: p.haste.moveSpeed }, p.haste.duration);
      break;
    case 'doubleDamage':
      buff(w, u, { id: 'rune_double_damage', damagePct: p.doubleDamage.baseDamageBonusPct }, p.doubleDamage.duration);
      break;
    case 'invisibility':
      buff(w, u, { id: 'rune_invisibility', invisible: true, breakOnAttack: true }, p.invisibility.duration);
      break;
    case 'regeneration':
      buff(
        w,
        u,
        {
          id: 'rune_regeneration',
          hpPerSecond: p.regeneration.totalHp / p.regeneration.duration,
          manaPerSecond: p.regeneration.totalMana / p.regeneration.duration,
          dispelOnDamage: p.regeneration.dispelOnDamage,
          endWhenFull: true,
        },
        p.regeneration.duration,
      );
      break;
    case 'illusion':
      // Stub: illusions are not simulated yet (the rune is consumed, nothing spawns).
      break;
    case 'bounty': {
      const b = RUNES.bounty;
      // Bounty minutes count from map start (pre-game included), see VERIFY.md #25.
      const reward = rune.first
        ? { xp: b.firstSpawnXp, gold: b.firstSpawnGold }
        : bountyRuneReward(Math.floor((w.time + CREEP_WAVES.preGameSeconds) / 60));
      giveGold(w, u, reward.gold, TUNABLES.bountyRuneGoldReliable, 'bounty_rune');
      addXp(w, u, reward.xp);
      break;
    }
  }
};

export const tickRunes = (w: World): void => {
  const s = w.runeState;
  while (w.time >= s.nextAt) {
    spawnRunes(w);
    s.nextAt += RUNES.interval;
  }
  if (w.runeList.length === 0) return;
  const r2 = TUNABLES.runePickupRadius * TUNABLES.runePickupRadius;
  for (let i = w.runeList.length - 1; i >= 0; i--) {
    const rune = w.runeList[i]!;
    for (const h of w.heroes) {
      if (!h.alive) continue;
      const dx = h.position.x - rune.x;
      const dy = h.position.y - rune.y;
      if (dx * dx + dy * dy > r2) continue;
      w.runeList.splice(i, 1);
      applyRune(w, h, rune);
      w.events.emit('rune:picked', { runeId: rune.id, kind: rune.kind, unitId: h.id });
      break;
    }
  }
};
