// Items for a 6.83d Sniper build. Source: 6.83d map ItemData.slk / ItemStrings.txt, the item
// stat abilities in AbilityData.slk, and the map script's item registry (cost array FU0, shop
// units) and recipe table (J50..JB0). Conventions: `attackSpeed` is an IAS fraction (0.15 = +15
// attack speed, like Buff.attackSpeed in core/sim.ts); recipes are items with a cost and no stats.
//
// DotA 1 names: Shadow Blade = Lothar's Edge, Daedalus = Buriza-do Kyanon, Morbid Mask = Mask of
// Death, Tango = Ancient Tango of Essifation. Dragon Lance does NOT exist in 6.83d (Dota 2 7.x).
import type { AbilityDef, ItemDef } from '../core/types';

const REG = '6.83d map war3map.j item registry (FU0 cost, shop unit)';
const RCP = '6.83d map war3map.j recipe table (J50..JB0)';

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------

export const TPSCROLL: ItemDef = {
  id: 'tpscroll',
  name: 'Scroll of Town Portal',
  cost: 100,
  shop: 'base',
  stats: {},
  active: 'item_tpscroll',
  source: `${REG}: I05I/h02E cost 100 (also sold at the side shop Goblin Laboratory u00Z); ability A1R5 — see sniper.ts ITEM_TPSCROLL_ABILITY`,
};

export const HEALING_SALVE: ItemDef = {
  id: 'healing_salve',
  name: 'Healing Salve',
  cost: 110,
  shop: 'base',
  stats: {},
  active: 'item_healing_salve',
  source: `${REG}: I05F/h029 cost 110, 1 charge; AIpr (AIrg DataA 400 HP, Dur 10, DataE 1 = dispel on attack)`,
};

export const CLARITY_POTION: ItemDef = {
  id: 'clarity_potion',
  name: 'Clarity Potion',
  cost: 50,
  shop: 'base',
  stats: {},
  active: 'item_clarity',
  source: `${REG}: I05D/h028 cost 50, 1 charge; AIpl (AIrg DataB 150 mana, Dur 40, DataE 1 = dispel on attack)`,
};

export const TANGO: ItemDef = {
  id: 'tango',
  name: 'Ancient Tango of Essifation',
  cost: 125,
  shop: 'base',
  stats: {},
  active: 'item_tango',
  source: `${REG}: I05C/h02A cost 125, 4 charges (uses 4); Ubertip "consume a tree, restoring 115 hit points over 16 seconds"; Aeat Rng 100`,
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export const BOOTS_OF_SPEED: ItemDef = {
  id: 'boots_of_speed',
  name: 'Boots of Speed',
  cost: 450,
  shop: 'base',
  stats: { moveSpeed: 50 },
  source: `${REG}: I02O/h011 cost 450; AIms DataA 50 (also side shop). Boot move speed bonuses don't stack`,
};

export const GLOVES_OF_HASTE: ItemDef = {
  id: 'gloves_of_haste',
  name: 'Gloves of Haste',
  cost: 500,
  shop: 'base',
  stats: { attackSpeed: 0.15 },
  source: `${REG}: I02P/h012 cost 500; AIsx (AIas DataA 0.15)`,
};

export const BOOTS_OF_ELVENSKIN: ItemDef = {
  id: 'boots_of_elvenskin',
  name: 'Boots of Elvenskin',
  cost: 450,
  shop: 'base',
  stats: { agi: 6 },
  source: `${REG}: I02R/h013 cost 450; AIa6 (AIab agi 6)`,
};

export const BELT_OF_GIANT_STRENGTH: ItemDef = {
  id: 'belt_of_giant_strength',
  name: 'Belt of Giant Strength',
  cost: 450,
  shop: 'base',
  stats: { str: 6 },
  source: `${REG}: I043/h016 cost 450; AIs6 (AIab str 6)`,
};

export const ROBE_OF_THE_MAGI: ItemDef = {
  id: 'robe_of_the_magi',
  name: 'Robe of the Magi',
  cost: 450,
  shop: 'base',
  stats: { int: 6 },
  source: `${REG}: I04W/h01Y cost 450; AIi6 (AIab int 6)`,
};

export const BLADES_OF_ATTACK: ItemDef = {
  id: 'blades_of_attack',
  name: 'Blades of Attack',
  cost: 450,
  shop: 'base',
  stats: { damage: 9 },
  source: `${REG}: I045/h018 cost 450; AIt9 (+9 damage)`,
};

export const BROADSWORD: ItemDef = {
  id: 'broadsword',
  name: 'Broadsword',
  cost: 1200,
  shop: 'base',
  stats: { damage: 18 },
  source: `${REG}: I046/h019 cost 1200; AItf 15 + AIat 3 damage`,
};

export const CLAYMORE: ItemDef = {
  id: 'claymore',
  name: 'Claymore',
  cost: 1400,
  shop: 'base',
  stats: { damage: 21 },
  source: `${REG}: I048/h01B cost 1400; AItf 15 + AIt6 6 damage`,
};

export const JAVELIN: ItemDef = {
  id: 'javelin',
  name: 'Javelin',
  cost: 1500,
  shop: 'base',
  stats: { damage: 21 },
  source: `${REG}: I055/h027 cost 1500; AItf 15 + AIt6 6 damage; Ubertip "20% chance to deal 40 bonus damage" (ITEM_PASSIVES)`,
};

export const MITHRIL_HAMMER: ItemDef = {
  id: 'mithril_hammer',
  name: 'Mithril Hammer',
  cost: 1600,
  shop: 'base',
  stats: { damage: 24 },
  source: `${REG}: I04M/h01O cost 1600; AItc x2 (12 + 12 damage)`,
};

export const OGRE_AXE: ItemDef = {
  id: 'ogre_axe',
  name: 'Ogre Axe',
  cost: 1000,
  shop: 'base',
  stats: { str: 10 },
  source: `${REG}: I04O/h01Q cost 1000; AIs1 + AIs3 + AIs6 (str 1+3+6)`,
};

export const QUARTERSTAFF: ItemDef = {
  id: 'quarterstaff',
  name: 'Quarterstaff',
  cost: 900,
  shop: 'base',
  stats: { damage: 10, attackSpeed: 0.1 },
  source: `${REG}: I04S/h01U cost 900; AItn +10 damage, A09I AIas 0.1`,
};

export const TALISMAN_OF_EVASION: ItemDef = {
  id: 'talisman_of_evasion',
  name: 'Talisman of Evasion',
  cost: 1800,
  shop: 'base',
  stats: {},
  source: `${REG}: I0J6/h083 cost 1800; A1BZ (AEev 0.25 evasion, ITEM_PASSIVES)`,
};

export const SHADOW_AMULET: ItemDef = {
  id: 'shadow_amulet',
  name: 'Shadow Amulet',
  cost: 1400,
  shop: 'base',
  stats: { attackSpeed: 0.3 },
  active: 'item_shadow_amulet_fade',
  source: `${REG}: I0PB/h0EI cost 1400; A0PJ AIas 0.3; A2N1 Fade, Ubertip "invisible after 1.5 seconds, moving cancels, cooldown 0"`,
};

export const HELM_OF_IRON_WILL: ItemDef = {
  id: 'helm_of_iron_will',
  name: 'Helm of Iron Will',
  cost: 950,
  shop: 'base',
  stats: { armor: 5, hpRegen: 3 },
  source: `${REG}: I04E/h01H cost 950; AId5 armor 5, A0PS Arel 3 HP/s (also side shop)`,
};

export const MASK_OF_DEATH: ItemDef = {
  id: 'mask_of_death',
  name: 'Mask of Death',
  cost: 900,
  shop: 'base',
  stats: {},
  source: `${REG}: I04K/h01M cost 900; A09P (AIva 0.15 life steal, orb, ITEM_PASSIVES). DotA name for Morbid Mask (also side shop)`,
};

export const DEMON_EDGE: ItemDef = {
  id: 'demon_edge',
  name: 'Demon Edge',
  cost: 2400,
  shop: 'secret',
  stats: { damage: 46 },
  source: `${REG}: I049/h01C cost 2400; A1HC +46 damage; sold by secret shop uC74 "Leragas The Vile"`,
};

export const EAGLEHORN: ItemDef = {
  id: 'eaglehorn',
  name: 'Eaglehorn',
  cost: 3300,
  shop: 'secret',
  stats: { agi: 25 },
  source: `${REG}: I04A/h01D cost 3300; A04D agi 25; secret shop uC74`,
};

export const MESSERSCHMIDTS_REAVER: ItemDef = {
  id: 'messerschmidts_reaver',
  name: "Messerschmidt's Reaver",
  cost: 3200,
  shop: 'secret',
  stats: { str: 25 },
  source: `${REG}: I04L/h01N cost 3200; A00I str 25; secret shop uC74`,
};

export const HYPERSTONE: ItemDef = {
  id: 'hyperstone',
  name: 'Hyperstone',
  cost: 2000,
  shop: 'secret',
  stats: { attackSpeed: 0.55 },
  source: `${REG}: I04F/h01I cost 2000; A09L AIas 0.55; secret shop uC74`,
};

// ---------------------------------------------------------------------------
// Recipes (bought as items; cost only)
// ---------------------------------------------------------------------------

export const MAELSTROM_RECIPE: ItemDef = {
  id: 'maelstrom_recipe',
  name: 'Maelstrom Recipe',
  cost: 700,
  shop: 'base',
  stats: {},
  source: `${REG}: I06V/h02U cost 700 (Enchanted Artifacts)`,
};

export const MJOLLNIR_RECIPE: ItemDef = {
  id: 'mjollnir_recipe',
  name: 'Mjollnir Recipe',
  cost: 900,
  shop: 'base',
  stats: {},
  source: `${REG}: I0KN/h03P cost 900 (Enchanted Artifacts)`,
};

export const CRYSTALYS_RECIPE: ItemDef = {
  id: 'crystalys_recipe',
  name: 'Crystalys Recipe',
  cost: 500,
  shop: 'base',
  stats: {},
  source: `${REG}: I07W/h034 cost 500 (Ancient Weaponry)`,
};

export const BURIZA_RECIPE: ItemDef = {
  id: 'buriza_recipe',
  name: 'Buriza-do Kyanon Recipe',
  cost: 1000,
  shop: 'base',
  stats: {},
  source: `6.83d map shop unit h03D goldcost 1000 (registry FU0 says 1200, but 2150 + 2400 + 1000 = 5550 = Buriza cost) — VERIFY`,
};

export const BLACK_KING_BAR_RECIPE: ItemDef = {
  id: 'black_king_bar_recipe',
  name: 'Black King Bar Recipe',
  cost: 1375,
  shop: 'base',
  stats: {},
  source: `${REG}: I07X/h035 cost 1375`,
};

export const SATANIC_RECIPE: ItemDef = {
  id: 'satanic_recipe',
  name: 'Satanic Recipe',
  cost: 1100,
  shop: 'base',
  stats: {},
  source: `${REG}: I085/h03H cost 1100 (Enchanted Artifacts)`,
};

// ---------------------------------------------------------------------------
// Completed items
// ---------------------------------------------------------------------------

const treadsStats = { moveSpeed: 50, attackSpeed: 0.3 };
const TREADS_SRC = `${REG}: Power Treads cost 1400; abilities A05U (AIms 50), A1HE (AIas 0.3), A1WN/A014/A1WM (+8 agi/str/int), A14A toggle; ${RCP}`;

export const POWER_TREADS_AGI: ItemDef = {
  id: 'power_treads_agi',
  name: 'Power Treads (Agility)',
  cost: 1400,
  shop: 'base',
  stats: { ...treadsStats, agi: 8 },
  active: 'item_power_treads_toggle',
  components: ['boots_of_speed', 'gloves_of_haste', 'boots_of_elvenskin'],
  source: `${TREADS_SRC} (I02T)`,
};

export const POWER_TREADS_STR: ItemDef = {
  id: 'power_treads_str',
  name: 'Power Treads (Strength)',
  cost: 1400,
  shop: 'base',
  stats: { ...treadsStats, str: 8 },
  active: 'item_power_treads_toggle',
  components: ['boots_of_speed', 'gloves_of_haste', 'belt_of_giant_strength'],
  source: `${TREADS_SRC} (I05Y)`,
};

export const POWER_TREADS_INT: ItemDef = {
  id: 'power_treads_int',
  name: 'Power Treads (Intelligence)',
  cost: 1400,
  shop: 'base',
  stats: { ...treadsStats, int: 8 },
  active: 'item_power_treads_toggle',
  components: ['boots_of_speed', 'gloves_of_haste', 'robe_of_the_magi'],
  source: `${TREADS_SRC} (I05Z)`,
};

export const MAELSTROM: ItemDef = {
  id: 'maelstrom',
  name: 'Maelstrom',
  cost: 2800,
  shop: 'base',
  stats: { damage: 24, attackSpeed: 0.25 },
  components: ['mithril_hammer', 'gloves_of_haste', 'maelstrom_recipe'],
  source: `${REG}: I08P cost 2800; A1C1 +24 dmg, A09X AIas 0.25, A0FJ chain lightning (Ubertip 25% chance, 120 damage, orb); ${RCP}`,
};

export const MJOLLNIR: ItemDef = {
  id: 'mjollnir',
  name: 'Mjollnir',
  cost: 5700,
  shop: 'base',
  stats: { damage: 24, attackSpeed: 0.8 },
  active: 'item_mjollnir_static_charge',
  components: ['hyperstone', 'maelstrom', 'mjollnir_recipe'],
  source: `${REG}: I0BE cost 5700; A1C1 +24 dmg, A1GX AIas 0.8, A0JH chain lightning (25%, 150 damage), A0JL Static Charge; ${RCP}`,
};

export const LOTHARS_EDGE: ItemDef = {
  id: 'lothars_edge',
  name: "Lothar's Edge",
  cost: 2800,
  shop: 'base',
  stats: { damage: 22, attackSpeed: 0.3 },
  active: 'item_lothars_windwalk',
  components: ['claymore', 'shadow_amulet'],
  source: `${REG}: I09H cost 2800; A0EJ +22 dmg, A0PJ AIas 0.3, A017 Wind Walk; ${RCP} (Claymore + Shadow Amulet, no recipe). DotA name for Shadow Blade`,
};

export const CRYSTALYS: ItemDef = {
  id: 'crystalys',
  name: 'Crystalys',
  cost: 2150,
  shop: 'base',
  stats: { damage: 30 },
  components: ['broadsword', 'blades_of_attack', 'crystalys_recipe'],
  source: `${REG}: I09C cost 2150; A0PK +30 dmg, A207 crit (AOcr 20%, 1.75x); ${RCP}`,
};

export const BURIZA_DO_KYANON: ItemDef = {
  id: 'buriza_do_kyanon',
  name: 'Buriza-do Kyanon',
  cost: 5550,
  shop: 'base',
  stats: { damage: 81 },
  components: ['crystalys', 'demon_edge', 'buriza_recipe'],
  source: `${REG}: I0A3 cost 5550; A1V2 +81 dmg, A09O crit (AOcr 25%, 2.4x); ${RCP}. DotA name for Daedalus`,
};

export const MONKEY_KING_BAR: ItemDef = {
  id: 'monkey_king_bar',
  name: 'Monkey King Bar',
  cost: 5400,
  shop: 'base',
  stats: { damage: 88, attackSpeed: 0.15 },
  active: 'item_mkb_toggle',
  components: ['demon_edge', 'javelin', 'javelin'],
  source:
    `${REG}: I0A5 cost 5400; A1FQ spellbook (A1X3 +88 dmg, AIsx 0.15), A1BY True Strike, A061 bash (35%, +100, 0.01 stun); ${RCP}. ` +
    'Ubertip: "True Strike is not compatible with … Headshot" — toggle True Strike off to keep Headshot',
};

export const THE_BUTTERFLY: ItemDef = {
  id: 'the_butterfly',
  name: 'The Butterfly',
  cost: 6000,
  shop: 'base',
  stats: { agi: 30, damage: 30, attackSpeed: 0.3 },
  active: 'item_butterfly_flutter',
  components: ['eaglehorn', 'quarterstaff', 'talisman_of_evasion'],
  source: `${REG}: I0AI cost 6000; A30R spellbook (A0PI agi 30, A0PJ AIas 0.3, A0PK +30 dmg), AIev 0.35 evasion, A31F Flutter (cd 35); ${RCP}`,
};

export const BLACK_KING_BAR: ItemDef = {
  id: 'black_king_bar',
  name: 'Black King Bar',
  cost: 3975,
  shop: 'base',
  stats: { str: 10, damage: 24 },
  active: 'item_bkb_avatar',
  components: ['ogre_axe', 'mithril_hammer', 'black_king_bar_recipe'],
  source: `${REG}: I0FZ "Black King Bar (10)" cost 3975; A015 str 10, AIti 4 + AItx 20 dmg; ${RCP}`,
};

export const HELM_OF_THE_DOMINATOR: ItemDef = {
  id: 'helm_of_the_dominator',
  name: 'Helm of the Dominator',
  cost: 1850,
  shop: 'base',
  stats: { armor: 5, hpRegen: 3, damage: 20 },
  active: 'item_dominate',
  components: ['helm_of_iron_will', 'mask_of_death'],
  source: `${REG}: I08T cost 1850; AId5 armor 5, A0PS 3 HP/s, AItx +20 dmg, A09P 15% life steal, A2V4 Dominate; ${RCP} (no recipe)`,
};

export const SATANIC: ItemDef = {
  id: 'satanic',
  name: 'Satanic',
  cost: 6150,
  shop: 'base',
  stats: { str: 25, damage: 20, armor: 5 },
  active: 'item_satanic_unholy_rage',
  components: ['messerschmidts_reaver', 'helm_of_the_dominator', 'satanic_recipe'],
  source: `${REG}: I0AB cost 6150; A00I str 25, A04T 25% life steal, AId5 armor 5; Ubertip +20 damage, Unholy Rage; ${RCP}`,
};

export const ITEM_DEFS: readonly ItemDef[] = [
  TPSCROLL,
  HEALING_SALVE,
  CLARITY_POTION,
  TANGO,
  BOOTS_OF_SPEED,
  GLOVES_OF_HASTE,
  BOOTS_OF_ELVENSKIN,
  BELT_OF_GIANT_STRENGTH,
  ROBE_OF_THE_MAGI,
  BLADES_OF_ATTACK,
  BROADSWORD,
  CLAYMORE,
  JAVELIN,
  MITHRIL_HAMMER,
  OGRE_AXE,
  QUARTERSTAFF,
  TALISMAN_OF_EVASION,
  SHADOW_AMULET,
  HELM_OF_IRON_WILL,
  MASK_OF_DEATH,
  DEMON_EDGE,
  EAGLEHORN,
  MESSERSCHMIDTS_REAVER,
  HYPERSTONE,
  MAELSTROM_RECIPE,
  MJOLLNIR_RECIPE,
  CRYSTALYS_RECIPE,
  BURIZA_RECIPE,
  BLACK_KING_BAR_RECIPE,
  SATANIC_RECIPE,
  POWER_TREADS_AGI,
  POWER_TREADS_STR,
  POWER_TREADS_INT,
  MAELSTROM,
  MJOLLNIR,
  LOTHARS_EDGE,
  CRYSTALYS,
  BURIZA_DO_KYANON,
  MONKEY_KING_BAR,
  THE_BUTTERFLY,
  BLACK_KING_BAR,
  HELM_OF_THE_DOMINATOR,
  SATANIC,
];

// ---------------------------------------------------------------------------
// Item abilities (actives) and passives
// ---------------------------------------------------------------------------

const base = {
  key: null,
  maxLevel: 1,
  requiredLevels: [1],
  manaCost: [0],
  castRange: [0],
  castPoint: 0,
};

const activeSelf = { ...base, kind: 'item' as const, targeting: 'self' as const };
const passiveItem = { ...base, kind: 'passive' as const, targeting: 'none' as const, cooldown: [0] };

export const ITEM_ABILITIES: readonly AbilityDef[] = [
  {
    ...base,
    id: 'item_healing_salve',
    name: 'Healing Salve',
    kind: 'item',
    targeting: 'unit',
    cooldown: [0],
    values: { totalHeal: [400], duration: [10], dispelOnDamage: [1] },
    description: 'Heals 400 HP over 10 s on a friendly unit; ends if the target is attacked.',
    source: '6.83d map AIpr (AIrg DataA 400, Dur 10, DataE 1). Cast range not set in object data (VERIFY)',
  },
  {
    ...activeSelf,
    id: 'item_clarity',
    name: 'Clarity Potion',
    cooldown: [0],
    values: { totalMana: [150], duration: [40], dispelOnDamage: [1] },
    description: 'Restores 150 mana over 40 s; ends if attacked.',
    source: '6.83d map AIpl (AIrg DataB 150, Dur 40, DataE 1)',
  },
  {
    ...base,
    id: 'item_tango',
    name: 'Eat Tree',
    kind: 'item',
    targeting: 'point',
    cooldown: [0],
    castRange: [100],
    values: { totalHeal: [115], duration: [16], charges: [4] },
    description: 'Consume a tree to restore 115 HP over 16 s.',
    source: '6.83d map I05C Ubertip (115 HP / 16 s, 4 charges), Aeat Rng 100',
  },
  {
    ...base,
    id: 'item_bkb_avatar',
    name: 'Avatar',
    kind: 'item',
    targeting: 'self',
    // "Level" = number of the use: duration and cooldown shrink by 1 s / 5 s per use, minimum 4 s / 50 s.
    maxLevel: 7,
    cooldown: [80, 75, 70, 65, 60, 55, 50],
    values: { duration: [10, 9, 8, 7, 6, 5, 4], magicImmune: [1] },
    description: 'Magic immunity. Each use shortens the next duration (10 → 4 s) and cooldown (80 → 50 s).',
    source: '6.83d map items I0FZ/I0G0/I0FY/I0FS/I09D/I0G1/I0P8 Ubertips (10..4 s, cooldown 80..50)',
  },
  {
    ...activeSelf,
    id: 'item_lothars_windwalk',
    name: 'Wind Walk',
    cooldown: [28],
    manaCost: [75],
    values: { duration: [14], fadeTime: [0.3], moveSpeedBonus: [0.2], backstabDamage: [175] },
    description: 'Invisible for 14 s with +20% move speed; the attack that breaks it deals +175 damage.',
    source: '6.83d map A017 (AOwk Dur 14, DataA 0.3, DataB 0.2, DataC 175, Cost 75, Cool 28)',
  },
  {
    ...activeSelf,
    id: 'item_shadow_amulet_fade',
    name: 'Fade',
    cooldown: [0],
    values: { fadeDelay: [1.5], cancelOnMove: [1] },
    description: 'Turn invisible after 1.5 s of standing still; moving cancels it.',
    source: '6.83d map I0PB Ubertip, A2N1 (AOwk)',
  },
  {
    ...activeSelf,
    id: 'item_satanic_unholy_rage',
    name: 'Unholy Rage',
    cooldown: [35],
    values: { lifesteal: [2.0], duration: [3.5] },
    description: '200% life steal for 3.5 s.',
    source: '6.83d map I0AB Ubertip (Unholy Rage 200% lifesteal 3.5 s, cooldown 35); A1FP Cool 35',
  },
  {
    ...activeSelf,
    id: 'item_butterfly_flutter',
    name: 'Flutter',
    cooldown: [35],
    values: { moveSpeedBonus: [0.2], duration: [8], removesEvasion: [1] },
    description: 'Trade the 35% evasion for +20% move speed for 8 s.',
    source: '6.83d map I0AI Ubertip, A31F Cool 35',
  },
  {
    ...base,
    id: 'item_mjollnir_static_charge',
    name: 'Static Charge',
    kind: 'item',
    targeting: 'unit',
    cooldown: [35],
    manaCost: [50],
    castRange: [600],
    values: { procChance: [0.2], damage: [200], procCooldown: [1] },
    description: 'Buff an ally: when damaged, 20% chance (max once per second) to strike the attacker for 200.',
    source: '6.83d map I0BE Ubertip; A0JL (Cool 35, Cost 50, Rng 600). Buff duration not in tooltip (VERIFY)',
  },
  {
    ...activeSelf,
    id: 'item_mkb_toggle',
    name: 'Toggle True Strike',
    targeting: 'none',
    cooldown: [3],
    values: {},
    description: 'Toggles True Strike. True Strike disables Headshot, so Sniper usually turns it off.',
    source: '6.83d map A1FO (MKBSwap, Cool 3), I0A5/I0K7 Ubertips',
  },
  {
    ...activeSelf,
    id: 'item_power_treads_toggle',
    name: 'Switch Attribute',
    targeting: 'none',
    cooldown: [0],
    values: {},
    description: 'Cycles the +8 attribute between Strength, Agility and Intelligence.',
    source: '6.83d map A14A (Power Treads toggle), I02T/I05Y/I05Z',
  },
  {
    ...base,
    id: 'item_dominate',
    name: 'Dominate',
    kind: 'item',
    targeting: 'unit',
    cooldown: [60],
    manaCost: [75],
    castRange: [700],
    values: { bonusHp: [500] },
    description: 'Take control of a non-ancient creep; it gets +500 HP.',
    source: '6.83d map A2V4 (Cool 60, Cost 75, Rng 700), I08T Ubertip "+500 HP bonus"',
  },
  // Passives
  {
    ...passiveItem,
    id: 'item_javelin_pierce',
    name: 'Pierce',
    values: { chance: [0.2], bonusDamage: [40] },
    description: '20% chance to deal 40 bonus damage.',
    source: '6.83d map I055 Ubertip',
  },
  {
    ...passiveItem,
    id: 'item_evasion_25',
    name: 'Evasion',
    values: { evasion: [0.25] },
    description: '25% chance to evade attacks.',
    source: '6.83d map A1BZ (AEev 0.25)',
  },
  {
    ...passiveItem,
    id: 'item_evasion_35',
    name: 'Evasion',
    values: { evasion: [0.35] },
    description: '35% chance to evade attacks.',
    source: '6.83d map AIev (AEev 0.35) on The Butterfly',
  },
  {
    ...passiveItem,
    id: 'item_lifesteal_15',
    name: 'Life Steal',
    values: { lifesteal: [0.15], orb: [1] },
    description: '15% life steal (orb effect, does not stack with other orbs).',
    source: '6.83d map A09P (AIva 0.15)',
  },
  {
    ...passiveItem,
    id: 'item_lifesteal_25',
    name: 'Life Steal',
    values: { lifesteal: [0.25], orb: [1] },
    description: '25% life steal (orb effect).',
    source: '6.83d map A04T (AIva 0.25)',
  },
  {
    ...passiveItem,
    id: 'item_chain_lightning_maelstrom',
    name: 'Chain Lightning',
    values: { chance: [0.25], damage: [120], orb: [1] },
    description: '25% chance on attack to release a 120-damage chain lightning.',
    source: '6.83d map I08P Ubertip; A0FJ (AIsb)',
  },
  {
    ...passiveItem,
    id: 'item_chain_lightning_mjollnir',
    name: 'Chain Lightning',
    values: { chance: [0.25], damage: [150], orb: [1] },
    description: '25% chance on attack to release a 150-damage chain lightning.',
    source: '6.83d map I0BE Ubertip; A0JH (AIsb)',
  },
  {
    ...passiveItem,
    id: 'item_crit_crystalys',
    name: 'Critical Strike',
    values: { chance: [0.2], multiplier: [1.75] },
    description: '20% chance for 1.75x damage.',
    source: '6.83d map A207 (AOcr DataA 20, DataB 1.75)',
  },
  {
    ...passiveItem,
    id: 'item_crit_buriza',
    name: 'Critical Strike',
    values: { chance: [0.25], multiplier: [2.4] },
    description: '25% chance for 2.4x damage.',
    source: '6.83d map A09O (AOcr DataA 25, DataB 2.4)',
  },
  {
    ...passiveItem,
    id: 'item_mkb_bash',
    name: 'Mini-Bash',
    values: { chance: [0.35], bonusDamage: [100], ministun: [0.01], trueStrike: [1] },
    description: '35% chance to deal 100 bonus damage and interrupt channels; True Strike (never miss).',
    source: '6.83d map A061 (AHbh DataA 35, DataC 100, Dur 0.01), A1BY True Strike',
  },
];

/** Passive item abilities per item id (core ItemDef has only `active`; see CONTRACT_REQUESTS.md). */
export const ITEM_PASSIVES: Record<string, string[]> = {
  javelin: ['item_javelin_pierce'],
  talisman_of_evasion: ['item_evasion_25'],
  the_butterfly: ['item_evasion_35'],
  mask_of_death: ['item_lifesteal_15'],
  helm_of_the_dominator: ['item_lifesteal_15'],
  satanic: ['item_lifesteal_25'],
  maelstrom: ['item_chain_lightning_maelstrom'],
  mjollnir: ['item_chain_lightning_mjollnir'],
  crystalys: ['item_crit_crystalys'],
  buriza_do_kyanon: ['item_crit_buriza'],
  monkey_king_bar: ['item_mkb_bash'],
};
