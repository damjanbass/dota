// Abilities owned by non-hero units (towers, ancients, fountains, Roshan) in DotA v6.83d.
// Source: 6.83d map AbilityData.slk (+ war3map.w3a level overrides) and war3map.j.
import type { AbilityDef } from '../core/types';

const passive = {
  kind: 'passive' as const,
  targeting: 'none' as const,
  key: null,
  maxLevel: 1,
  requiredLevels: [1],
  cooldown: [0],
  manaCost: [0],
  castRange: [0],
  castPoint: 0,
};

export const TOWER_TRUE_SIGHT: AbilityDef = {
  ...passive,
  id: 'tower_true_sight',
  name: 'Tower True Sight',
  values: { radius: [900] },
  description: 'Towers reveal invisible units within 900.',
  source: '6.83d map Adts (Tower Truesight, Rng 900) on e00R/e011/e00S/e019 and u00M/u00D/u00N/u00T',
};

export const ANCIENT_TRUE_SIGHT: AbilityDef = {
  ...passive,
  id: 'ancient_true_sight',
  name: 'True Sight',
  values: { radius: [900] },
  description: 'The Ancients reveal invisible units within 900.',
  source: '6.83d map Atru (Rng 900) in abilList of etol / unpl',
};

export const FOUNTAIN_TRUE_SIGHT: AbilityDef = {
  ...passive,
  id: 'fountain_true_sight',
  name: 'True Sight',
  values: { radius: [1200] },
  description: 'Fountains reveal invisible units within 1200.',
  source: '6.83d map A2ZJ (Atru, Rng 1200) on nfoh / ndfl',
};

export const FOUNTAIN_REGEN_AURA: AbilityDef = {
  ...passive,
  id: 'fountain_regen_aura',
  name: 'Fountain Regeneration',
  values: {
    radius: [825],
    /** Fraction of max HP restored per second. */
    hpPctPerSecond: [0.02],
    /** Fraction of max mana restored per second. */
    manaPctPerSecond: [0.02],
    /** Additional flat mana per second. */
    manaFlatPerSecond: [7],
  },
  description: 'Allies near the fountain regenerate 2% max HP and 2% max mana (+7 mana) per second.',
  source:
    '6.83d map nfoh/ndfl abilList: ACnr (Aoar regen aura, Area 825, DataA 0.02, DataB 1 = percent), ANre (Aarm mana aura, 825, 0.02 percent), A0VL (Aarm, 825, DataA 7 flat) — per-second semantics VERIFY',
};

export const ROSHAN_BASH: AbilityDef = {
  ...passive,
  id: 'roshan_bash',
  name: 'Bash',
  values: { chance: [0.15], bonusDamage: [50], stunDuration: [1.65] },
  description: '15% chance on attack to stun for 1.65 s and deal 50 bonus damage.',
  source: '6.83d map A14B (AHbh DataA 15, DataC 50, Dur/HeroDur 1.65)',
};

export const ROSHAN_SLAM: AbilityDef = {
  id: 'roshan_slam',
  name: 'Slam',
  kind: 'active',
  targeting: 'none',
  key: null,
  maxLevel: 15,
  requiredLevels: [1],
  cooldown: [6],
  manaCost: [0],
  castRange: [0],
  castPoint: 0.47,
  values: {
    radius: [350],
    damage: [70, 90, 110, 130, 150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350],
    moveSlow: [0.5],
    attackSlow: [0.5],
    duration: [4],
    heroDuration: [2],
    /** Slam level = 1 + floor(map time / 240). */
    levelUpInterval: [240],
  },
  description: 'Roshan slams the ground, damaging and slowing nearby enemies. Gets stronger every 4 minutes.',
  source:
    '6.83d map ACtc (Area 350, Cool 6, DataA 70/90/110 + w3a Ctc1 130..350, DataC/D 0.5, Dur 4, HeroDur 2); war3map.j B4O (level = 1 + R2I(time/240)); Roshan castpt 0.47',
};

export const ROSHAN_SPELL_BLOCK: AbilityDef = {
  ...passive,
  id: 'roshan_spell_block',
  name: 'Spell Block',
  cooldown: [15],
  values: { blocks: [1] },
  description: 'Blocks one targeted spell every 15 seconds.',
  source: '6.83d map ANss (Spell Shield, Cool 15) in Roshan abilList',
};

export const ROSHAN_SPELL_RESISTANCE: AbilityDef = {
  ...passive,
  id: 'roshan_spell_resistance',
  name: 'Spell Damage Reduction',
  values: { spellDamageReduction: [0.75] },
  description: 'Roshan takes 75% less damage from spells.',
  source: '6.83d map A0PW (AIsr DataB 0.75) in Roshan abilList — semantics VERIFY',
};

export const ROSHAN_ARMOR_GROWTH: AbilityDef = {
  ...passive,
  id: 'roshan_armor_growth',
  name: 'Roshan Aura',
  maxLevel: 20,
  values: {
    /** Self armor bonus at ability level L = 0.5 * L. Level = growth level + 1 (rises every 300 s). */
    armorPerLevel: [0.5],
    interval: [300],
  },
  description: 'Roshan gains 0.5 armor every 5 minutes (on top of +600 HP and +12 damage per level, see ROSHAN_RULES).',
  source: '6.83d map A142 (AHad self, DataA 0.5/1/1.5 + w3a Had1 2.0..10.0 for levels 4-20); war3map.j B8O (FL0 every 300 s sets level count+1)',
};

export const UNIT_ABILITIES: readonly AbilityDef[] = [
  TOWER_TRUE_SIGHT,
  ANCIENT_TRUE_SIGHT,
  FOUNTAIN_TRUE_SIGHT,
  FOUNTAIN_REGEN_AURA,
  ROSHAN_BASH,
  ROSHAN_SLAM,
  ROSHAN_SPELL_BLOCK,
  ROSHAN_SPELL_RESISTANCE,
  ROSHAN_ARMOR_GROWTH,
];
