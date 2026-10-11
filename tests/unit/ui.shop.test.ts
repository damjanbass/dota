import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/data';
import { buildRecipeTree, buildShopGroups, buildsInto, isRecipe, missingParts, remainingCost, statLines, treeCost } from '../../src/ui/shopData';

describe('ui shop groups', () => {
  const groups = buildShopGroups(ITEMS);

  it('puts every item in exactly one DotA shop group', () => {
    const seen = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(Object.keys(ITEMS).sort());
  });

  it('groups consumables, secret shop items and upgrades', () => {
    const by = Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => i.id)]));
    expect(by.consumables).toContain('tpscroll');
    expect(by.secret).toEqual(expect.arrayContaining(['demon_edge', 'eaglehorn', 'hyperstone', 'messerschmidts_reaver']));
    for (const id of by.secret!) expect(ITEMS[id]!.shop).toBe('secret');
    expect(by.upgrades).toEqual(expect.arrayContaining(['buriza_do_kyanon', 'power_treads_agi', 'maelstrom_recipe']));
    for (const g of groups) for (let i = 1; i < g.items.length; i++) expect(g.items[i]!.cost).toBeGreaterThanOrEqual(g.items[i - 1]!.cost);
  });

  it('detects recipe scrolls only', () => {
    expect(isRecipe(ITEMS.satanic_recipe!)).toBe(true);
    expect(isRecipe(ITEMS.mask_of_death!)).toBe(false);
    expect(isRecipe(ITEMS.talisman_of_evasion!)).toBe(false);
  });
});

describe('ui shop recipe trees', () => {
  it('builds nested trees whose leaves add up to the item cost', () => {
    const buriza = buildRecipeTree('buriza_do_kyanon', ITEMS);
    expect(buriza.children.map((c) => c.item.id)).toEqual(['crystalys', 'demon_edge', 'buriza_recipe']);
    expect(buriza.children[0]!.children.map((c) => c.item.id)).toEqual(['broadsword', 'blades_of_attack', 'crystalys_recipe']);
    for (const item of Object.values(ITEMS)) {
      if (!item.components?.length) continue;
      expect(treeCost(buildRecipeTree(item.id, ITEMS)), item.id).toBe(item.cost);
    }
  });

  it('marks owned parts and lists what is still missing', () => {
    const tree = buildRecipeTree('buriza_do_kyanon', ITEMS, ['crystalys', null, 'tpscroll']);
    expect(tree.children[0]!.owned).toBe(true);
    expect(missingParts(tree).map((i) => i.id)).toEqual(['demon_edge', 'buriza_recipe']);
    expect(remainingCost(tree)).toBe(ITEMS.demon_edge!.cost + ITEMS.buriza_recipe!.cost);
  });

  it('needs one owned copy per duplicate component (MKB = 2 Javelins)', () => {
    const one = buildRecipeTree('monkey_king_bar', ITEMS, ['javelin']);
    expect(missingParts(one).map((i) => i.id)).toEqual(['demon_edge', 'javelin']);
    const two = buildRecipeTree('monkey_king_bar', ITEMS, ['javelin', 'javelin']);
    expect(missingParts(two).map((i) => i.id)).toEqual(['demon_edge']);
  });

  it('uses components deep in the tree', () => {
    const tree = buildRecipeTree('buriza_do_kyanon', ITEMS, ['broadsword']);
    expect(tree.children[0]!.owned).toBe(false);
    expect(tree.children[0]!.children[0]!.owned).toBe(true);
    expect(missingParts(tree).map((i) => i.id)).toEqual(['blades_of_attack', 'crystalys_recipe', 'demon_edge', 'buriza_recipe']);
  });

  it('owning the item itself does not cover buying another', () => {
    expect(missingParts(buildRecipeTree('tpscroll', ITEMS, ['tpscroll'])).map((i) => i.id)).toEqual(['tpscroll']);
  });

  it('lists upgrades and readable stats', () => {
    expect(buildsInto('demon_edge', ITEMS).map((i) => i.id)).toEqual(expect.arrayContaining(['buriza_do_kyanon', 'monkey_king_bar']));
    expect(statLines(ITEMS.gloves_of_haste!)).toEqual(['+15 Attack Speed']);
  });
});
