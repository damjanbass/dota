// Game-rule tables for DotA Allstars v6.83d.
// Primary source: the 6.83d map itself (source-map/DotA v6.83d.w3x): war3mapMisc.txt (gameplay
// constants), Units/*.slk object data and the map script (scripts/war3map.j, function names are the
// optimizer's obfuscated names). Anything not found in the map is labelled and listed in VERIFY.md.
import type { ArmorType, AttackType } from '../core/types';

const MISC = '6.83d map war3mapMisc.txt';
const JASS = '6.83d map war3map.j';

// ---------------------------------------------------------------------------
// Hero XP
// ---------------------------------------------------------------------------

export const HERO_XP = {
  maxLevel: 25,
  /** Total (cumulative) XP needed to reach each level. Index 0 = level 1. */
  totalXpForLevel: [
    0, 200, 500, 900, 1400, 2000, 2600, 3200, 4400, 5400, 6000, 8200, 9000, 10400, 11900, 13500, 15200, 17000, 18900, 20900,
    23000, 25200, 27500, 29900, 32400,
  ],
  source: `${MISC} NeedHeroXP (24 entries for levels 2..25), MaxHeroLevel=25`,
};

/**
 * XP granted for killing a hero, by the dying hero's level (index 0 = level 1). Split evenly among
 * the enemy heroes within `shareRadius` of the victim, on top of the assist bonus in HERO_KILL_REWARDS.
 */
export const HERO_KILL_XP = {
  byVictimLevel: [
    100, 120, 160, 220, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000,
    2100, 2200, 2300,
  ],
  formula: 'levels 1-4: 100/120/160/220; level >= 5: 100 * level - 200',
  source: `${JASS} RUI (hero XP bounty) + ARO (split among heroes in range)`,
};

/** XP for killing non-hero units, by WC3 unit level. Shared evenly among heroes in range. */
export const CREEP_XP = {
  /** Index 0 = unit level 1. Levels 1-6 are a table; 7+ follow 2.5L^2 + 8.5L + 14 (truncated). */
  byUnitLevel: [25, 41, 62, 88, 119, 155, 196, 242, 293, 349],
  formulaAbove6: '2.5 * L^2 + 8.5 * L + 14 (truncated to int), capped at level 25',
  /** Unit-type overrides (WC3 unit id → XP), used instead of the level table. */
  overrides: { nstl: 62, nsth: 119, n026: 88, ndtw: 119 } as Record<string, number>,
  /** Heroes within this radius of the dying unit share its XP evenly (script adds +25 to it). */
  shareRadius: 1300,
  shareRadiusFudge: 25,
  summonedMultiplier: 0.5,
  rules: [
    'XP is only granted when the killer is an enemy of the dying unit (not neutral-owned, not a deny).',
    'Dead heroes and illusions get no share; the XP is split evenly between all eligible heroes in range.',
    'Neutral (non-ancient) creeps share XP with heroes of either team in range.',
  ],
  source: `${JASS} SQI (level table), AXO overrides, ARO/ASO (1300+25 radius, even split), ALO (summons x0.5)`,
};

/** Deny rules (unit killed by an ally). */
export const DENY = {
  /** Denied units give no gold. */
  goldToDenier: 0,
  /**
   * Enemy heroes within `radius` of the denied unit still get XP: each melee hero gets
   * xpPoolMeleeHero / n and each ranged hero xpPoolRangedHero / n, where n = enemy heroes in range.
   */
  xpPoolMeleeHero: 31,
  xpPoolRangedHero: 20,
  radius: 1300,
  /** Lane creeps can be denied; towers too (team gold is halved, see TEAM_GOLD.towerDenied). */
  source: `${JASS} BLO/BXO (deny XP 31 melee / 20 ranged pool, 1300+25 radius), ARO (no XP path for denies)`,
};

// ---------------------------------------------------------------------------
// Gold
// ---------------------------------------------------------------------------

export const GOLD = {
  /**
   * Starting gold. Not set by the 6.83d script; best source is the Dota 2 port of 6.79
   * ("Starting gold increased from 603 to 625"). See VERIFY.md.
   */
  startingGold: 625,
  startingGoldSource: 'Liquipedia Archive:Version 6.79 (D2 port of 6.79) — VERIFY',
  /** +1 gold to every player every 0.6 s, starting with the first creep wave (unreliable gold). */
  passiveGoldAmount: 1,
  passiveGoldInterval: 0.6,
  /** Hero kill bounty to the killer: base + perLevel * victimLevel + streak bonus (reliable gold). */
  heroKillBase: 200,
  heroKillPerVictimLevel: 9,
  /** Bonus for ending a streak, keyed by the victim's kill streak (3 = killing spree … 10+ = beyond godlike). */
  streakBonusByStreak: { 3: 60, 4: 120, 5: 180, 6: 240, 7: 300, 8: 360, 9: 420, 10: 480 } as Record<number, number>,
  /** Killed by creeps / towers of a team: the bounty is split evenly among that team's players. */
  nonHeroKillSplitsAmongTeam: true,
  /** Gold lost on death = perLevel * level, taken only from unreliable gold. */
  deathGoldLossPerLevel: 30,
  source: `${JASS} U31 (passive 1 gold / 0.6 s), OPO (kill bounty 100+9L+100, streaks, 30*L loss capped at unreliable gold), O0O (team split)`,
};

/** Assist rewards for every enemy hero within 1300 of a dying hero (n = number of such heroes). */
export const HERO_KILL_REWARDS = {
  radius: 1300,
  /** XP per assisting hero = perLevel[n] * victimLevel + teamXpFactor[n] * K. */
  xpPerVictimLevel: [20, 15, 10, 7, 5],
  xpComebackFactor: [0.23, 0.23, 0.2, 0.15, 0.12],
  /** Gold per assisting hero = base[n] + perLevel[n] * victimLevel + netWorthFactor[n] * T (reliable). */
  goldBase: [40, 30, 20, 10, 10],
  goldPerVictimLevel: [7, 6, 5, 4, 4],
  goldComebackFactor: [0.05, 0.05, 0.05, 0.04, 0.03],
  comebackTerms:
    'K = max((XP of victim team - XP of killer team) / (sum), 0) * victim XP; ' +
    'T = clamp(victim team net worth / killer team net worth - 1, 0, 1) * victim net worth',
  source: `${JASS} OEO (assist XP/gold by number of heroes in 1300+25 range)`,
};

/** Team gold for structures (every player of the killing team, reliable gold). */
export const TEAM_GOLD = {
  /** Index 0 = tier 1. */
  tower: [160, 200, 240, 280],
  /** Same tower killed by its own team (deny) — the enemy team still gets this much. */
  towerDenied: [80, 100, 120, 140],
  barracksRanged: 100,
  barracksMelee: 175,
  /** Roshan kill: every player of the killing team. */
  roshan: 200,
  source: `${JASS} R3I (towers), R6I (barracks), BXO region (Roshan +200 each)`,
};

/** Creep bounty ranges are on each UnitDef (bountyGoldMin/Max = plus + dice .. plus + dice*sides). */
export const CREEP_BOUNTY_NOTE = {
  rule: 'Bounty = bountyplus + roll of (dice)d(sides); only the last-hitting player gets it (unreliable gold).',
  source: '6.83d map UnitBalance.slk bountyplus/bountydice/bountysides',
};

// ---------------------------------------------------------------------------
// Damage and armor
// ---------------------------------------------------------------------------

export const ARMOR = {
  /** Positive armor: reduction = k*a / (1 + k*a). */
  reductionPerPoint: 0.06,
  /** Negative armor: damage multiplier = 2 - 0.94^(-a). */
  negativeBase: 0.94,
  source:
    'WC3 default DefenseArmor=0.06 (not overridden in 6.83d war3mapMisc.txt); formulas from classic.hiveworkshop.com war3/basics/armorandweapontypes',
};

/**
 * Attack type × armor type damage multipliers as DotA 6.83d used them. Normal/Pierce/Siege/Magic/Chaos
 * rows are overridden by the map; Hero and Spells rows are WC3 TFT defaults (not overridden).
 */
export const DAMAGE_TABLE: Record<AttackType, Record<ArmorType, number>> = {
  normal: { light: 1.0, medium: 1.5, heavy: 1.25, fortified: 0.7, normal: 1.0, hero: 0.75, divine: 0.05, unarmored: 1.0 },
  pierce: { light: 2.0, medium: 0.75, heavy: 0.75, fortified: 0.35, normal: 1.0, hero: 0.5, divine: 0.05, unarmored: 1.5 },
  siege: { light: 1.0, medium: 0.5, heavy: 1.25, fortified: 1.5, normal: 1.0, hero: 0.75, divine: 0.05, unarmored: 1.0 },
  magic: { light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, normal: 1.0, hero: 0.75, divine: 0.05, unarmored: 1.0 },
  chaos: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.4, normal: 1.0, hero: 1.0, divine: 1.0, unarmored: 1.0 },
  hero: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, normal: 1.0, hero: 1.0, divine: 0.05, unarmored: 1.0 },
  spells: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 1.0, normal: 1.0, hero: 0.7, divine: 0.5, unarmored: 1.0 },
};

export const DAMAGE_TABLE_SOURCE =
  `${MISC} DamageBonusNormal/Pierce/Siege/Magic/Chaos (column order light,medium,heavy,fortified,normal,hero,divine,unarmored); ` +
  'hero + spells rows: WC3 TFT chart (classic.hiveworkshop.com) + warcraft.wiki.gg (divine) — VERIFY';

/**
 * Hero base magic resistance. Heroes take 75% from Magic attack type (map override) — used as the
 * DotA "25% magic resistance". Trigger spells often use the WC3 "Spells" type (0.70 vs hero). See VERIFY.md.
 */
export const HERO_MAGIC_RESISTANCE = {
  value: 0.25,
  source: `${MISC} DamageBonusMagic hero column 0.75; D2 port of 6.83 base 25% — VERIFY (Spells row gives 30%)`,
};

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export const ATTRIBUTES = {
  hpPerStr: 19,
  hpRegenPerStr: 0.03,
  manaPerInt: 13,
  manaRegenPerInt: 0.04,
  armorPerAgi: 0.14,
  /** Added to every hero's object-data armor before the agility bonus. */
  heroArmorBase: -1,
  /** Attack speed (IAS fraction) per agility point: 0.01 = +1 IAS. */
  iasPerAgi: 0.01,
  moveSpeedPerAgi: 0,
  damagePerPrimary: 1,
  /** Hero object data base HP before strength (all DotA heroes use 150). */
  heroBaseHp: 150,
  maxMoveSpeed: 522,
  minMoveSpeed: 100,
  source: `${MISC} StrHitPointBonus=19, StrRegenBonus=0.03, IntManaBonus=13, IntRegenBonus=0.04, AgiDefenseBonus=0.14, AgiDefenseBase=-1.0, AgiAttackSpeedBonus=0.01, AgiMoveBonus=0, MaxUnitSpeed=522, MinUnitSpeed=100`,
};

// ---------------------------------------------------------------------------
// Death, respawn, buyback
// ---------------------------------------------------------------------------

export const RESPAWN = {
  /** Respawn seconds = floor(perLevel * level + base) (+ buyback penalty, see BUYBACK). */
  perLevel: 3.8,
  base: 5,
  source: `${JASS} OPO: R2I((GetHeroLevel*3.8+5)*modifiers) + YS[player]`,
};

export const BUYBACK = {
  /** cost = 50 * floor((base + perLevelSquared * level^2 + perMinute * minutes) / 50), minutes = floor(game time / 60). */
  costBase: 100,
  costPerLevelSquared: 1.5,
  costPerMinute: 15,
  costRoundDownTo: 50,
  /** Cost table index is capped at 59 (max 2950 gold). */
  maxCost: 2950,
  cooldown: 360,
  /** 25% of the remaining respawn time is added to the next death. */
  nextRespawnPenaltyOfRemaining: 0.25,
  /** After buying back, no unreliable gold until the normal respawn time would have ended. */
  blocksUnreliableGoldUntilNormalRespawn: true,
  source: `${JASS} GV1 (cost), WS[] table, WD1 (25% penalty), h0D4/A20U stockRegen/cooldown 360`,
};

// ---------------------------------------------------------------------------
// Creep waves
// ---------------------------------------------------------------------------

export const CREEP_WAVES = {
  /** Pre-game: creeps spawn 90 s after the game mode is set. The game clock is 0:00 at the horn. */
  preGameSeconds: 90,
  firstWaveAt: 0,
  interval: 30,
  initialMelee: 3,
  initialRanged: 1,
  /** +1 melee creep per wave at these game times (seconds after the horn). */
  extraMeleeAt: [999, 1999, 2999],
  /** +1 ranged creep (and +1 siege) per wave at these times. */
  extraRangedAt: [2699],
  /** Siege creeps join every 7th wave (waves 7, 14, 21, …); siege count = current ranged count. */
  siegeEveryNthWave: 7,
  /** Every 450 s each lane creep type gets +1 upgrade level (max 30). Siege creeps don't scale. */
  upgradeInterval: 450,
  upgradeMaxLevel: 30,
  /** Per upgrade level. */
  upgradePerLevel: {
    melee: { damage: 1, hp: 10 },
    ranged: { damage: 2, hp: 10 },
    meleeSuper: { damage: 2, hp: 19 },
    rangedSuper: { damage: 3, hp: 18 },
  },
  /**
   * Destroying an enemy barracks makes YOUR creeps in that lane super creeps (melee rax → melee,
   * ranged rax → ranged + siege). When all 6 enemy barracks are dead, your super creep upgrades
   * jump +30 levels (= max) — the map calls this "Mega Creeps".
   */
  megaCreepsUpgradeLevels: 30,
  /**
   * First 7 minutes (map time < 420 s): for 15 s after spawning, side-lane groups get a move speed
   * modifier so lanes meet closer to the offlane tower. Lane marker 2 (inferred top): Scourge +25%,
   * Sentinel -25%; lane marker 4 (inferred bottom): Sentinel +25%, Scourge -25%; mid unchanged.
   */
  earlyLaneSpeed: { firstSeconds: 420, buffDuration: 15, fasterPct: 0.25, slowerPct: -0.25 },
  source: `${JASS} IU2 (90 s countdown, ZG every 30 s), SPO (spawn), SZO/SVO + A2V0/A2V1 (early lane speed), SOO/SIO (+1 melee at 999/1999/2999 s, +1 ranged at 2699 s), TQO (UG every 450 s), TNO/TRO (mega +30); upgrades R003/R007/R008/R009/R00A/R00B/R00C/R00D in UpgradeData.slk`,
};

// ---------------------------------------------------------------------------
// Day / night, runes, neutrals, Roshan timers
// ---------------------------------------------------------------------------

export const DAY_NIGHT = {
  /** A full 24h WC3 day lasts dayLength / timeScale seconds. */
  dayLength: 300,
  timeScale: 0.625,
  /** Resulting cycle: 240 s day (06:00-18:00) then 240 s night. */
  daySeconds: 240,
  nightSeconds: 240,
  /** Time of day is reset to 06:00 (dawn) at the horn, so the game starts at the beginning of day. */
  startHour: 6,
  dawnHour: 6,
  duskHour: 18,
  preGameTimeScale: 0.5,
  source: `${MISC} DayLength=300; ${JASS} IU2 SetFloatGameState(TIME_OF_DAY,6.00) + SetTimeOfDayScale(0.625) at the horn (0.5 pre-game); 6/18 dawn/dusk = WC3 default`,
};

export const RUNES = {
  /** Spawns at the horn (0:00) and every 120 s; the previous runes are removed. */
  interval: 120,
  firstAt: 0,
  /** Two rune spots: one random power rune + one Bounty rune, sides chosen at random each time. */
  spots: 2,
  /** A power rune type is never the same as the previous one. */
  powerRunes: {
    haste: { duration: 30, moveSpeed: 522 },
    doubleDamage: { duration: 45, baseDamageBonusPct: 1.0 },
    illusion: { duration: 75, count: 2, damageDealtPct: 0.35, extraDamageTakenPct: 3.0 },
    regeneration: { duration: 30, totalHp: 3000, totalMana: 2000, dispelOnDamage: true },
    invisibility: { duration: 45 },
  },
  /** Bounty rune: XP = 50 + 5*min, gold = 50 + 2*min (min = whole minutes of map time). First spawn: both spots bounty, 100 XP + 100 gold. */
  bounty: { xpBase: 50, xpPerMinute: 5, goldBase: 50, goldPerMinute: 2, firstSpawnXp: 100, firstSpawnGold: 100 },
  source: `${JASS} IU2 (J20 at horn + every 120 s), CBO (spawn), CAO (no repeat), FUO (bounty); items I006/I007/I008/I00J/I00K/I0RC + abilities AIsp/AIrr/AIsl/AIv1`,
};

export const NEUTRALS = {
  /** First spawn 30 s after the horn, then every 60 s (on the minute). */
  firstSpawnAt: 30,
  interval: 60,
  /**
   * Each camp has a spawn rect; a new random group spawns only when no living unit is inside it
   * (wards, Broodmother webs and Stone rocks don't block). Groups never repeat twice in a row.
   * Stacking: pull the camp out of its rect right before the minute mark → a second group spawns.
   */
  blockRule: 'any living unit (hero, creep, summon) inside the camp rect blocks the spawn',
  camps: { small: 2, medium: 4, large: 4, ancient: 2 },
  /** Neutrals leash back after chasing this far (WC3 guard settings). */
  guardDistance: 600,
  guardReturnTime: 3,
  source: `${JASS} IU2 (IQ2 at 30 s, OH every 60 s), P3O/P2O/POO (rect empty check), R1O (no repeat); ${MISC} GuardDistance=600, MaxGuardDistance=600, GuardReturnTime=3`,
};

export const ROSHAN_RULES = {
  respawnAfterDeath: 600,
  /** Aegis is reclaimed this long after Roshan dies (warnings at 3 min and 1 min left). */
  aegisExpiresAfter: 300,
  /** Unused Aegis: holder heals 20% HP+mana per second for up to 5 s (stops on damage). */
  aegisExpiryHealPctPerSecond: 0.2,
  aegisReviveDelay: 5,
  /** Cheese (2500 HP + 1000 mana) drops from the 2nd Roshan kill onward. */
  cheeseFromKill: 2,
  /** Every 300 s of game time Roshan's growth level rises by 1 (+600 HP, +12 damage per level via R00F; armor aura +0.5/level). */
  growthInterval: 300,
  growthHpPerLevel: 600,
  growthDamagePerLevel: 12,
  growthArmorPerLevel: 0.5,
  /** Slam level = 1 + floor(map time / 240); Slam damage = 70 + 20 * (level - 1). */
  slamLevelInterval: 240,
  /** If Roshan is outside his pit for two 10 s checks he is moved back. */
  leashCheckInterval: 10,
  source: `${JASS} FJ0=600, FK0=300, BEO/BGO (respawn), B6O/B9O/B2O (aegis), B8O (FL0 every 300 s → R00F + A142), B4O (slam level, leash); UpgradeData.slk R00F; AbilityData.slk A142, ACtc; items I0AW (AIrc delay 5), I0B1`,
};

// ---------------------------------------------------------------------------
// Buildings: invulnerability and backdoor protection
// ---------------------------------------------------------------------------

export const TOWER_RULES = {
  /** All buildings start invulnerable; tier 1 towers become vulnerable with the first creep wave. */
  tier1VulnerableAt: 'first creep wave',
  chain: [
    'Tier 1 dies → tier 2 tower in the same lane becomes vulnerable.',
    'Tier 2 dies → tier 3 tower in the same lane becomes vulnerable.',
    'Tier 3 dies → that lane’s melee + ranged barracks, both tier 4 towers and all filler base buildings become vulnerable.',
    'Both tier 4 towers dead → the Ancient (World Tree / Frozen Throne) becomes vulnerable.',
  ],
  /** Backdoor protection applies to tier 2-4 towers, all barracks and the Ancient (not tier 1). */
  backdoorProtected: ['tower_t2', 'tower_t3', 'tower_t4', 'barracks_melee', 'barracks_ranged', 'ancient'],
  /** Checked every 5 s: are enemy lane creeps inside the building's protection rect? */
  creepCheckInterval: 5,
  /** Without enemy creeps nearby: 25% of hero damage is healed back instantly (illusions: ~81%). */
  noCreepDamageHealPct: 0.25,
  illusionDamageHealPct: 0.25,
  /** Without enemy creeps nearby the building regenerates this much HP per second… */
  noCreepRegenPerSecond: 90,
  /** …but never above (max HP - damage taken while enemy creeps were present or from allies). */
  regenCapExcludesCreepWindowDamage: true,
  source: `${JASS} HB1/HC1 (all invulnerable), SPO (T1 vulnerable at wave 1), AJ2/AV2/AW2 (chain), I62 (25% heal), UKO (TZ0=90 HP/s every 1 s), IR2 (5 s creep check)`,
};

/** WC3 / DotA aggro and acquisition behaviours relevant to the AI. */
export const AGGRO = {
  rules: [
    'Units auto-acquire targets within their acquisition range (UnitDef source notes give "acquire").',
    'Siege creeps that attack a non-structure re-target to a visible enemy structure within 900, or — if they were attacking a hero — to a visible non-hero enemy within 900.',
    'Re-targeted siege creeps resume attack-moving along their lane once their order stops being an attack (checked every 4 s).',
    'WC3 engine: attacking an enemy hero near enemy creeps makes those creeps switch to you (call-for-help); DotA does not change this. Exact WC3 call-for-help radius not in the map — see VERIFY.md.',
  ],
  attackNotifyRange: 1000,
  siegeRetargetRadius: 900,
  source: `${JASS} O12/OI2 (siege retarget, 900), O22/OO2 (every 4 s); ${MISC} AttackNotifyRange=1000`,
};
