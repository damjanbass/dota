// Derived combat stats: level/attribute math (src/data heroStatsAtLevel) + item stat bonuses + buffs.
import { scaledRange } from '../core/config';
import type { DerivedStats } from '../core/sim';
import type { HeroDef } from '../core/types';
import { ATTRIBUTES, ITEMS, armorMultiplier, attackTypeMultiplier, heroStatsAtLevel } from '../data';
import type { AttackType, ArmorType } from '../core/types';
import { TUNABLES } from './tunables';
import type { SimUnit } from './types';

export interface ItemTotals {
  str: number;
  agi: number;
  int: number;
  damage: number;
  armor: number;
  attackSpeed: number;
  /** Boot speed bonuses don't stack: the largest one counts. */
  moveSpeed: number;
  hp: number;
  mana: number;
  hpRegen: number;
  manaRegen: number;
  attackRange: number;
}

export const itemTotals = (items: ReadonlyArray<string | null>): ItemTotals => {
  const t: ItemTotals = { str: 0, agi: 0, int: 0, damage: 0, armor: 0, attackSpeed: 0, moveSpeed: 0, hp: 0, mana: 0, hpRegen: 0, manaRegen: 0, attackRange: 0 };
  for (const id of items) {
    if (!id) continue;
    const s = ITEMS[id]?.stats;
    if (!s) continue;
    t.str += s.str ?? 0;
    t.agi += s.agi ?? 0;
    t.int += s.int ?? 0;
    t.damage += s.damage ?? 0;
    t.armor += s.armor ?? 0;
    t.attackSpeed += s.attackSpeed ?? 0;
    t.moveSpeed = Math.max(t.moveSpeed, s.moveSpeed ?? 0);
    t.hp += s.hp ?? 0;
    t.mana += s.mana ?? 0;
    t.hpRegen += s.hpRegen ?? 0;
    t.manaRegen += s.manaRegen ?? 0;
    t.attackRange += s.attackRange ?? 0;
  }
  return t;
};

export interface StatsResult {
  stats: DerivedStats;
  maxHp: number;
  maxMana: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Full derived stats for a unit at the current day/night state. */
export const computeStats = (u: SimUnit, isDay: boolean): StatsResult => {
  const def = u.def;
  let baseMin: number;
  let baseMax: number;
  let bonusDamage = u.bonusDamage;
  let armor: number;
  let hpRegen: number;
  let manaRegen: number;
  let ias = 0;
  let range = def.attackRange;
  let moveBase = def.moveSpeed;
  let maxHp: number;
  let maxMana: number;

  if (u.hero) {
    const h = u.hero;
    const it = itemTotals(h.items);
    const hero = def as HeroDef;
    const lv = heroStatsAtLevel(hero, h.level, { str: it.str, agi: it.agi, int: it.int });
    const hasAttr = it.str !== 0 || it.agi !== 0 || it.int !== 0;
    const white = hasAttr ? heroStatsAtLevel(hero, h.level) : lv;
    baseMin = white.damageMin;
    baseMax = white.damageMax;
    // Attribute damage from items is green (bonus) damage in WC3, so Double Damage doesn't double it.
    bonusDamage += lv.damageMin - white.damageMin + it.damage;
    armor = lv.armor + it.armor + u.bonusArmor;
    hpRegen = lv.hpRegen + it.hpRegen;
    manaRegen = lv.manaRegen + it.manaRegen;
    ias = lv.attackSpeedBonus + it.attackSpeed;
    range += it.attackRange;
    moveBase += it.moveSpeed;
    maxHp = lv.hp + it.hp + u.bonusHp;
    maxMana = lv.mana + it.mana;
  } else {
    baseMin = def.damageMin;
    baseMax = def.damageMax;
    armor = def.armor + u.bonusArmor;
    hpRegen = def.hpRegen;
    manaRegen = def.manaRegen;
    maxHp = def.hp + u.bonusHp;
    maxMana = def.mana;
  }

  let damagePct = 0;
  let movePct = 0;
  let fixedMove = 0;
  for (const b of u.buffs) {
    if (b.damagePct) damagePct += b.damagePct;
    if (b.damage) bonusDamage += b.damage;
    if (b.armor) armor += b.armor;
    if (b.attackSpeed) ias += b.attackSpeed;
    if (b.attackRange) range += b.attackRange;
    if (b.moveSpeedPct) movePct += b.moveSpeedPct;
    if (b.fixedMoveSpeed && b.fixedMoveSpeed > fixedMove) fixedMove = b.fixedMoveSpeed;
  }

  ias = clamp(ias, TUNABLES.minIas, TUNABLES.maxIas);
  const bat = def.attackCooldown;
  let moveSpeed = 0;
  if (moveBase > 0) {
    moveSpeed = fixedMove > 0 ? fixedMove : clamp(moveBase * (1 + movePct), ATTRIBUTES.minMoveSpeed, ATTRIBUTES.maxMoveSpeed);
  }

  const stats: DerivedStats = {
    damageMin: baseMin * (1 + damagePct) + bonusDamage,
    damageMax: baseMax * (1 + damagePct) + bonusDamage,
    armor,
    armorType: def.armorType,
    attackType: def.attackType,
    attackCooldown: bat > 0 ? bat / (1 + ias) : 0,
    attackRange: scaledRange(Math.max(0, range)),
    moveSpeed,
    vision: scaledRange(isDay ? def.visionDay : def.visionNight),
    magicResistance: def.magicResistance,
    hpRegen,
    manaRegen,
  };
  return { stats, maxHp, maxMana };
};

/** Damage multiplier for physical damage: WC3 armor formula × attack-type/armor-type table (when typed). */
export const physicalMultiplier = (armor: number, attackType: AttackType | undefined, armorType: ArmorType): number =>
  armorMultiplier(armor) * (attackType ? attackTypeMultiplier(attackType, armorType) : 1);

/** Damage multiplier for magical damage. */
export const magicalMultiplier = (magicResistance: number): number => 1 - clamp(magicResistance, 0, 1);
