// Per-hero skill and item builds for bots (6.83d ability ids / ITEMS names). Ultimates at 6/11/16.
// Item lists only use items present in src/data/items.ts; completed items are bought directly (the sim
// credits owned components).

export interface HeroBuild {
  /** One entry per hero level from 1; unlearnable entries fall back to the first learnable skill. */
  skills: string[];
  items: string[];
}

const P = { q: 'pudge_meat_hook', w: 'pudge_rot', e: 'pudge_flesh_heap', r: 'pudge_dismember' };
const L = { q: 'lion_impale', w: 'lion_voodoo', e: 'lion_mana_drain', r: 'lion_finger_of_death' };
const V = { q: 'viper_poison_attack', w: 'viper_nethertoxin', e: 'viper_corrosive_skin', r: 'viper_strike' };
const S = { q: 'sf_shadowraze', w: 'sf_necromastery', e: 'sf_presence_of_the_dark_lord', r: 'sf_requiem_of_souls' };
const K = { q: 'lich_frost_nova', w: 'lich_frost_armor', e: 'lich_dark_ritual', r: 'lich_chain_frost' };
const N = { q: 'sniper_shrapnel', w: 'sniper_headshot', e: 'sniper_take_aim', r: 'sniper_assassinate' };

const order = (k: { q: string; w: string; e: string; r: string }, seq: string): string[] =>
  [...seq].map((c) => (c === 'q' ? k.q : c === 'w' ? k.w : c === 'e' ? k.e : k.r));

export const BUILDS: Record<string, HeroBuild> = {
  pudge: {
    skills: order(P, 'qwqwqrqwwereeeer'),
    items: ['tango', 'healing_salve', 'clarity_potion', 'boots_of_speed', 'power_treads_str', 'black_king_bar', 'helm_of_the_dominator'],
  },
  lion: {
    skills: order(L, 'qeqwqrqwwwreeeer'),
    items: ['tango', 'clarity_potion', 'healing_salve', 'boots_of_speed', 'power_treads_int', 'black_king_bar'],
  },
  viper: {
    skills: order(V, 'qeqwqrqwwwreeeer'),
    items: ['tango', 'healing_salve', 'boots_of_speed', 'power_treads_agi', 'maelstrom', 'black_king_bar', 'the_butterfly'],
  },
  shadow_fiend: {
    skills: order(S, 'wqwqwrwqqereeeer'),
    items: ['tango', 'healing_salve', 'boots_of_speed', 'power_treads_agi', 'black_king_bar', 'crystalys', 'buriza_do_kyanon', 'satanic'],
  },
  lich: {
    skills: order(K, 'qeqwqrqeeerwwwwr'),
    items: ['tango', 'clarity_potion', 'healing_salve', 'boots_of_speed', 'power_treads_int', 'black_king_bar'],
  },
  sniper: {
    skills: order(N, 'qwqwqrqweerweeer'),
    items: ['tango', 'healing_salve', 'boots_of_speed', 'power_treads_agi', 'maelstrom', 'crystalys', 'buriza_do_kyanon'],
  },
};

export const buildFor = (heroId: string, skills: readonly string[]): HeroBuild =>
  BUILDS[heroId] ?? { skills: [...skills, ...skills, ...skills, ...skills], items: ['tango', 'healing_salve', 'boots_of_speed'] };
