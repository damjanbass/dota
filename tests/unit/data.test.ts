import { describe, expect, it } from 'vitest';
import type { AbilityDef, ArmorType, AttackType } from '../../src/core/types';
import {
  ABILITIES,
  ATTRIBUTES,
  DAMAGE_TABLE,
  HEROES,
  HERO_KILL_XP,
  HERO_XP,
  ITEMS,
  ITEM_PASSIVES,
  NEUTRAL_CAMPS,
  SNIPER,
  UNITS,
  UNIT_EXTRAS,
  armorMultiplier,
  attackTypeMultiplier,
  buybackCost,
  creepXpForLevel,
  heroKillGold,
  heroKillXp,
  heroLevelFromXp,
  heroStatsAtLevel,
  levelValue,
  respawnTime,
} from '../../src/data';

// Records force a compile error if a union member is missing.
const ATTACK_TYPES: Record<AttackType, true> = { normal: true, pierce: true, siege: true, magic: true, chaos: true, spells: true, hero: true };
const ARMOR_TYPES: Record<ArmorType, true> = {
  unarmored: true,
  light: true,
  medium: true,
  heavy: true,
  fortified: true,
  hero: true,
  divine: true,
  normal: true,
};

const abilities = Object.values(ABILITIES);
const perLevelArrays = (a: AbilityDef): Array<[string, readonly number[]]> => [
  ['cooldown', a.cooldown],
  ['manaCost', a.manaCost],
  ['castRange', a.castRange],
  ['requiredLevels', a.requiredLevels],
  ...Object.entries(a.values),
];

describe('ability data', () => {
  it('every per-level array has length maxLevel or 1', () => {
    for (const a of abilities) {
      for (const [key, arr] of perLevelArrays(a)) {
        const ok = arr.length === 1 || arr.length === a.maxLevel;
        expect(ok, `${a.id}.${key} has ${arr.length} entries, maxLevel ${a.maxLevel}`).toBe(true);
        for (const v of arr) expect(Number.isFinite(v), `${a.id}.${key}`).toBe(true);
      }
    }
  });

  it('hero skills use DotA level requirements (ult at 6/11/16)', () => {
    for (const hero of Object.values(HEROES)) {
      expect(hero.skills).toHaveLength(4);
      for (const id of hero.skills) {
        const a = ABILITIES[id];
        expect(a, `${hero.id} skill ${id}`).toBeDefined();
        if (!a) continue;
        if (a.kind === 'ultimate') {
          expect(a.maxLevel).toBe(3);
          expect(a.requiredLevels).toEqual([6, 11, 16]);
        } else {
          expect(a.maxLevel).toBe(4);
          expect(a.requiredLevels).toEqual([1, 3, 5, 7]);
        }
      }
      expect(hero.skills.filter((id) => ABILITIES[id]?.kind === 'ultimate')).toHaveLength(1);
    }
  });

  it('Sniper kit keys and 6.83d core numbers', () => {
    expect(ABILITIES.sniper_shrapnel?.key).toBe('Q');
    expect(ABILITIES.sniper_take_aim?.key).toBe('E');
    expect(ABILITIES.sniper_assassinate?.key).toBe('R');
    expect(ABILITIES.item_tpscroll?.key).toBe('F');
    expect(ABILITIES.sniper_headshot?.key).toBeNull();
    const shrapnel = ABILITIES.sniper_shrapnel!;
    expect(levelValue(shrapnel, 'charges', 4)).toBe(3);
    expect(levelValue(shrapnel, 'damagePerSecond', 3)).toBe(36);
    const assassinate = ABILITIES.sniper_assassinate!;
    expect(levelValue(assassinate, 'damage', 3)).toBe(655);
    expect(levelValue(assassinate, 'castRange', 2)).toBe(2500);
  });
});

describe('registries', () => {
  it('ids are unique and match their keys; every object has a source', () => {
    for (const reg of [UNITS, ABILITIES, ITEMS] as const) {
      for (const [key, def] of Object.entries(reg)) {
        expect(def.id).toBe(key);
        expect(def.source.length, `${key} source`).toBeGreaterThan(10);
      }
    }
  });

  it('unit abilities, item actives/passives and components resolve', () => {
    for (const u of Object.values(UNITS)) for (const id of u.abilities) expect(ABILITIES[id], `${u.id} → ${id}`).toBeDefined();
    for (const item of Object.values(ITEMS)) {
      if (item.active) expect(ABILITIES[item.active], `${item.id} active`).toBeDefined();
      for (const c of item.components ?? []) expect(ITEMS[c], `${item.id} component ${c}`).toBeDefined();
    }
    for (const [itemId, ids] of Object.entries(ITEM_PASSIVES)) {
      expect(ITEMS[itemId]).toBeDefined();
      for (const id of ids) expect(ABILITIES[id]).toBeDefined();
    }
    for (const camp of Object.values(NEUTRAL_CAMPS)) {
      for (const group of camp.groups) for (const id of group) expect(UNITS[id], `camp unit ${id}`).toBeDefined();
    }
    for (const id of Object.keys(UNITS)) expect(UNIT_EXTRAS[id], `extra for ${id}`).toBeDefined();
  });

  it('recipe costs add up', () => {
    for (const item of Object.values(ITEMS)) {
      if (!item.components) continue;
      const sum = item.components.reduce((acc, c) => acc + (ITEMS[c]?.cost ?? Number.NaN), 0);
      expect(sum, item.id).toBe(item.cost);
    }
  });

  it('hero level-1 stats follow the 6.83d attribute constants', () => {
    for (const h of Object.values(HEROES)) {
      expect(h.hp).toBeCloseTo(ATTRIBUTES.heroBaseHp + h.str * ATTRIBUTES.hpPerStr, 6);
      expect(h.mana).toBeCloseTo(h.int * ATTRIBUTES.manaPerInt, 6);
      expect(h.armor).toBeCloseTo(ATTRIBUTES.heroArmorBase + h.agi * ATTRIBUTES.armorPerAgi, 6);
    }
    expect(SNIPER.hp).toBe(454);
    expect(SNIPER.damageMin).toBe(36);
    expect(SNIPER.damageMax).toBe(42);
  });
});

describe('tables', () => {
  it('damage matrix is complete for every attack × armor pair', () => {
    for (const attack of Object.keys(ATTACK_TYPES) as AttackType[]) {
      for (const armor of Object.keys(ARMOR_TYPES) as ArmorType[]) {
        const v = DAMAGE_TABLE[attack][armor];
        expect(Number.isFinite(v), `${attack} vs ${armor}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(attackTypeMultiplier(attack, armor)).toBe(v);
      }
    }
    expect(attackTypeMultiplier('pierce', 'hero')).toBe(0.5);
    expect(attackTypeMultiplier('normal', 'hero')).toBe(0.75);
    expect(attackTypeMultiplier('siege', 'fortified')).toBe(1.5);
  });

  it('hero XP table has 25 strictly increasing levels', () => {
    const t = HERO_XP.totalXpForLevel;
    expect(t).toHaveLength(25);
    expect(t[0]).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    expect(t[24]).toBe(32400);
    expect(HERO_KILL_XP.byVictimLevel).toHaveLength(25);
  });
});

describe('helpers', () => {
  it('armorMultiplier uses the WC3 formula', () => {
    expect(armorMultiplier(0)).toBe(1);
    // 0.06*5 / (1 + 0.06*5) = 0.2308 reduction
    expect(1 - armorMultiplier(5)).toBeCloseTo(0.2308, 4);
    expect(1 - armorMultiplier(1)).toBeCloseTo(0.0566, 4);
    // negative 10 armor: +46.1% damage
    expect(armorMultiplier(-10)).toBeCloseTo(1.4614, 4);
  });

  it('heroLevelFromXp', () => {
    expect(heroLevelFromXp(0)).toBe(1);
    expect(heroLevelFromXp(199)).toBe(1);
    expect(heroLevelFromXp(200)).toBe(2);
    expect(heroLevelFromXp(2000)).toBe(6);
    expect(heroLevelFromXp(32399)).toBe(24);
    expect(heroLevelFromXp(32400)).toBe(25);
    expect(heroLevelFromXp(1e9)).toBe(25);
  });

  it('levelValue handles single-element arrays, clamping and top-level arrays', () => {
    const hook = ABILITIES.pudge_meat_hook!;
    expect(levelValue(hook, 'damage', 1)).toBe(90);
    expect(levelValue(hook, 'damage', 4)).toBe(360);
    expect(levelValue(hook, 'damage', 9)).toBe(360);
    expect(levelValue(hook, 'hitRadius', 3)).toBe(125);
    expect(levelValue(hook, 'cooldown', 2)).toBe(13);
    expect(() => levelValue(hook, 'nope', 1)).toThrow();
  });

  it('hero stats, kill rewards, respawn and buyback', () => {
    const s1 = heroStatsAtLevel(SNIPER, 1);
    expect(s1.hp).toBe(454);
    expect(s1.attackCooldown).toBeCloseTo(1.7 / 1.21, 6);
    const s2 = heroStatsAtLevel(SNIPER, 2);
    expect(s2.agi).toBeCloseTo(23.9, 6);
    expect(s2.damageMin).toBeCloseTo(38.9, 6);
    expect(s2.hp).toBeCloseTo(454 + 1.7 * 19, 6);
    expect(heroKillXp(1)).toBe(100);
    expect(heroKillXp(5)).toBe(300);
    expect(heroKillXp(25)).toBe(2300);
    expect(creepXpForLevel(3)).toBe(62);
    expect(creepXpForLevel(7)).toBe(196);
    expect(heroKillGold(1, 0)).toBe(209);
    expect(heroKillGold(10, 3)).toBe(200 + 90 + 60);
    expect(heroKillGold(10, 14)).toBe(200 + 90 + 480);
    expect(respawnTime(1)).toBe(8);
    expect(respawnTime(25)).toBe(100);
    expect(buybackCost(1, 0)).toBe(100);
    expect(buybackCost(25, 30 * 60)).toBe(1450);
  });
});
