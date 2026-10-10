// Public entry point for DotA v6.83d game data: registries plus pure helpers.
import type { AbilityDef, ArmorType, AttackType, HeroDef, ItemDef, UnitDef } from '../core/types';
import type { UnitExtra } from './extra';
import { LICH, LICH_ABILITIES, LICH_EXTRA } from './heroes/lich';
import { LION, LION_ABILITIES, LION_EXTRA } from './heroes/lion';
import { PUDGE, PUDGE_ABILITIES, PUDGE_EXTRA } from './heroes/pudge';
import { SHADOW_FIEND, SHADOW_FIEND_ABILITIES, SHADOW_FIEND_EXTRA } from './heroes/shadowFiend';
import { VIPER, VIPER_ABILITIES, VIPER_EXTRA } from './heroes/viper';
import { ITEM_ABILITIES, ITEM_DEFS } from './items';
import { SNIPER, SNIPER_ABILITIES, SNIPER_EXTRA } from './sniper';
import { ARMOR, ATTRIBUTES, BUYBACK, CREEP_XP, DAMAGE_TABLE, GOLD, HERO_KILL_XP, HERO_XP, RESPAWN, RUNES } from './tables';
import { UNIT_ABILITIES } from './unitAbilities';
import { ALL_UNITS, UNIT_EXTRA } from './units';

export * from './extra';
export * from './heroes/lich';
export * from './heroes/lion';
export * from './heroes/pudge';
export * from './heroes/shadowFiend';
export * from './heroes/viper';
export * from './items';
export * from './sniper';
export * from './tables';
export * from './unitAbilities';
export * from './units';

const byId = <T extends { id: string }>(list: readonly T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const entry of list) {
    if (out[entry.id]) throw new Error(`duplicate data id: ${entry.id}`);
    out[entry.id] = entry;
  }
  return out;
};

export const HERO_LIST: readonly HeroDef[] = [SNIPER, PUDGE, LION, VIPER, SHADOW_FIEND, LICH];

/** Every hero, keyed by id. */
export const HEROES: Record<string, HeroDef> = byId(HERO_LIST);

/** Every unit definition including heroes (HeroDef extends UnitDef), keyed by id. */
export const UNITS: Record<string, UnitDef> = byId<UnitDef>([...ALL_UNITS, ...HERO_LIST]);

/** Every ability: hero skills, item actives/passives, building and Roshan abilities. */
export const ABILITIES: Record<string, AbilityDef> = byId<AbilityDef>([
  ...SNIPER_ABILITIES,
  ...PUDGE_ABILITIES,
  ...LION_ABILITIES,
  ...VIPER_ABILITIES,
  ...SHADOW_FIEND_ABILITIES,
  ...LICH_ABILITIES,
  ...ITEM_ABILITIES,
  ...UNIT_ABILITIES,
]);

export const ITEMS: Record<string, ItemDef> = byId(ITEM_DEFS);

/** Extra WC3 fields (backswing, acquisition range, …) for every unit and hero id. */
export const UNIT_EXTRAS: Record<string, UnitExtra> = {
  ...UNIT_EXTRA,
  sniper: SNIPER_EXTRA,
  pudge: PUDGE_EXTRA,
  lion: LION_EXTRA,
  viper: VIPER_EXTRA,
  shadow_fiend: SHADOW_FIEND_EXTRA,
  lich: LICH_EXTRA,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Damage multiplier from armor (WC3 formula): positive armor → 1 / (1 + 0.06a)
 * (i.e. reduction 0.06a / (1 + 0.06a)); negative armor → 2 - 0.94^(-a).
 */
export const armorMultiplier = (armor: number): number => {
  if (armor >= 0) return 1 / (1 + ARMOR.reductionPerPoint * armor);
  return 2 - Math.pow(ARMOR.negativeBase, -armor);
};

/** Attack type × armor type multiplier from the 6.83d damage table. */
export const attackTypeMultiplier = (attack: AttackType, armor: ArmorType): number => DAMAGE_TABLE[attack][armor];

/** Hero level (1..25) for a total XP amount. */
export const heroLevelFromXp = (xp: number): number => {
  const table = HERO_XP.totalXpForLevel;
  let level = 1;
  for (let i = 1; i < table.length; i++) {
    if (xp >= table[i]!) level = i + 1;
    else break;
  }
  return level;
};

const LEVEL_ARRAYS = ['cooldown', 'manaCost', 'castRange', 'requiredLevels'] as const;

/**
 * Per-level ability value (level is 1-based). Looks in `values` first, then the top-level per-level
 * arrays (cooldown, manaCost, castRange, requiredLevels). Single-element arrays apply to every level;
 * levels beyond the array use the last entry. Throws on an unknown key.
 */
export const levelValue = (def: AbilityDef, key: string, level: number): number => {
  let arr: readonly number[] | undefined = def.values[key];
  if (!arr && (LEVEL_ARRAYS as readonly string[]).includes(key)) arr = def[key as (typeof LEVEL_ARRAYS)[number]];
  if (!arr || arr.length === 0) throw new Error(`ability ${def.id} has no value '${key}'`);
  const idx = Math.min(Math.max(Math.floor(level), 1), arr.length) - 1;
  return arr[idx]!;
};

export interface HeroLevelStats {
  str: number;
  agi: number;
  int: number;
  hp: number;
  hpRegen: number;
  mana: number;
  manaRegen: number;
  armor: number;
  damageMin: number;
  damageMax: number;
  /** IAS fraction from agility (0.01 per point). */
  attackSpeedBonus: number;
  /** Seconds between attacks after agility IAS. */
  attackCooldown: number;
}

/**
 * Hero stats at a level (1..25) from the level-1 HeroDef, plus optional flat attribute bonuses
 * (items / Attribute Bonus). Uses the 6.83d attribute constants in tables.ts ATTRIBUTES.
 */
export const heroStatsAtLevel = (hero: HeroDef, level: number, bonus: { str?: number; agi?: number; int?: number } = {}): HeroLevelStats => {
  const a = ATTRIBUTES;
  const lv = Math.min(Math.max(Math.floor(level), 1), HERO_XP.maxLevel) - 1;
  const str = hero.str + hero.strGain * lv + (bonus.str ?? 0);
  const agi = hero.agi + hero.agiGain * lv + (bonus.agi ?? 0);
  const int = hero.int + hero.intGain * lv + (bonus.int ?? 0);
  const primaryAt1 = hero[hero.primary];
  const primaryNow = hero.primary === 'str' ? str : hero.primary === 'agi' ? agi : int;
  const attackSpeedBonus = agi * a.iasPerAgi;
  return {
    str,
    agi,
    int,
    hp: hero.hp + (str - hero.str) * a.hpPerStr,
    hpRegen: hero.hpRegen + (str - hero.str) * a.hpRegenPerStr,
    mana: hero.mana + (int - hero.int) * a.manaPerInt,
    manaRegen: hero.manaRegen + (int - hero.int) * a.manaRegenPerInt,
    armor: hero.armor + (agi - hero.agi) * a.armorPerAgi,
    damageMin: hero.damageMin + (primaryNow - primaryAt1) * a.damagePerPrimary,
    damageMax: hero.damageMax + (primaryNow - primaryAt1) * a.damagePerPrimary,
    attackSpeedBonus,
    attackCooldown: hero.attackCooldown / (1 + attackSpeedBonus),
  };
};

/** XP for killing a hero of this level (before splitting among nearby heroes). */
export const heroKillXp = (victimLevel: number): number => {
  const t = HERO_KILL_XP.byVictimLevel;
  return t[Math.min(Math.max(Math.floor(victimLevel), 1), t.length) - 1]!;
};

/** XP for killing a non-hero unit of a WC3 unit level (before splitting). */
export const creepXpForLevel = (unitLevel: number): number => {
  const lv = Math.min(Math.max(Math.floor(unitLevel), 0), 25);
  if (lv === 0) return 0;
  if (lv <= 6) return CREEP_XP.byUnitLevel[lv - 1]!;
  return Math.trunc(2.5 * lv * lv + 8.5 * lv + 14);
};

/** Gold bounty for killing a hero (killer's share before streak splitting rules). */
export const heroKillGold = (victimLevel: number, victimStreak: number): number => {
  const streak = victimStreak >= 10 ? GOLD.streakBonusByStreak[10]! : (GOLD.streakBonusByStreak[victimStreak] ?? 0);
  return GOLD.heroKillBase + GOLD.heroKillPerVictimLevel * victimLevel + streak;
};

/** Respawn time in seconds (no buyback penalty). */
export const respawnTime = (level: number): number => Math.floor(RESPAWN.perLevel * level + RESPAWN.base);

/** Buyback gold cost at a hero level and game time (seconds since the horn). */
export const buybackCost = (level: number, gameTimeSeconds: number): number => {
  const minutes = Math.floor(Math.max(gameTimeSeconds, 0) / 60);
  const raw = BUYBACK.costBase + BUYBACK.costPerLevelSquared * level * level + BUYBACK.costPerMinute * minutes;
  const steps = Math.min(Math.max(Math.floor(raw / BUYBACK.costRoundDownTo), 0), 59);
  return steps * BUYBACK.costRoundDownTo;
};

/** Bounty rune reward for whole minutes of map time (first spawn uses RUNES.bounty.firstSpawn*). */
export const bountyRuneReward = (minutes: number): { xp: number; gold: number } => ({
  xp: RUNES.bounty.xpBase + RUNES.bounty.xpPerMinute * Math.floor(minutes),
  gold: RUNES.bounty.goldBase + RUNES.bounty.goldPerMinute * Math.floor(minutes),
});
