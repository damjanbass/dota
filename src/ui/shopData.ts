// Shop catalogue logic: DotA-style shop groups and recipe trees built from ITEMS.
// Pure, covered by ui.shop.test.ts.
import type { ItemDef } from '../core/types';

export type ShopGroupId = 'consumables' | 'attributes' | 'armaments' | 'arcane' | 'secret' | 'upgrades';

export interface ShopGroup {
  id: ShopGroupId;
  /** Tab label. */
  label: string;
  /** In-map shop that sells this group (WC3 DotA flavour). */
  shopName: string;
  /** Where the item can be bought from. */
  shop: ItemDef['shop'];
  items: ItemDef[];
}

/**
 * Basic-item placement in the 6.83d Sentinel shops (Scourge shops mirror them). Anything not listed falls
 * back by data: secret-shop items → Secret Shop, items with components → Upgrades, recipes → Upgrades
 * (shown inside their item's tree), everything else → Arcane.
 */
const BASIC_GROUP: Record<string, ShopGroupId> = {
  tpscroll: 'consumables',
  healing_salve: 'consumables',
  clarity_potion: 'consumables',
  tango: 'consumables',
  belt_of_giant_strength: 'attributes',
  boots_of_elvenskin: 'attributes',
  robe_of_the_magi: 'attributes',
  ogre_axe: 'attributes',
  blades_of_attack: 'armaments',
  broadsword: 'armaments',
  claymore: 'armaments',
  javelin: 'armaments',
  mithril_hammer: 'armaments',
  quarterstaff: 'armaments',
  helm_of_iron_will: 'armaments',
  boots_of_speed: 'arcane',
  gloves_of_haste: 'arcane',
  mask_of_death: 'arcane',
  talisman_of_evasion: 'arcane',
  shadow_amulet: 'arcane',
};

const GROUP_META: Record<ShopGroupId, { label: string; shopName: string }> = {
  consumables: { label: 'Consumables', shopName: 'Ancient of Wonders' },
  attributes: { label: 'Attributes', shopName: 'Sena the Accessorizer' },
  armaments: { label: 'Armaments', shopName: 'Weapons Dealer' },
  arcane: { label: 'Arcane', shopName: 'Gateway Relics' },
  secret: { label: 'Secret Shop', shopName: 'Leragas the Vile' },
  upgrades: { label: 'Upgrades', shopName: 'Recipe shops' },
};

export const SHOP_GROUP_ORDER: readonly ShopGroupId[] = ['consumables', 'attributes', 'armaments', 'arcane', 'secret', 'upgrades'];

/** A recipe scroll: named "... Recipe", no stats or active (it only exists to be combined). */
export const isRecipe = (item: ItemDef): boolean =>
  (/(^|_)recipe$/.test(item.id) || / Recipe$/.test(item.name)) && Object.keys(item.stats).length === 0 && !item.active;

export const groupOf = (item: ItemDef): ShopGroupId => {
  if (item.shop === 'secret') return 'secret';
  if (item.components?.length) return 'upgrades';
  const basic = BASIC_GROUP[item.id];
  if (basic) return basic;
  if (isRecipe(item)) return 'upgrades';
  return 'arcane';
};

/** Shop tabs in DotA order; items sorted by cost inside each tab. Every item lands in exactly one group. */
export const buildShopGroups = (items: Record<string, ItemDef>): ShopGroup[] => {
  const groups = SHOP_GROUP_ORDER.map<ShopGroup>((id) => ({
    id,
    ...GROUP_META[id],
    shop: id === 'secret' ? 'secret' : 'base',
    items: [],
  }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const item of Object.values(items)) byId.get(groupOf(item))!.items.push(item);
  for (const g of groups) g.items.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return groups;
};

// ---------------------------------------------------------------------------
// Recipe trees
// ---------------------------------------------------------------------------

export interface RecipeNode {
  item: ItemDef;
  children: RecipeNode[];
  /** Covered by the inventory: this item (or all of its parts) is owned. */
  owned: boolean;
}

/**
 * Builds the component tree of an item. `owned` is the inventory (item ids, duplicates allowed); owned
 * items are consumed top-down so two Javelins need two Javelins.
 */
export const buildRecipeTree = (itemId: string, items: Record<string, ItemDef>, owned: ReadonlyArray<string | null> = []): RecipeNode => {
  const pool = new Map<string, number>();
  for (const id of owned) if (id) pool.set(id, (pool.get(id) ?? 0) + 1);
  const take = (id: string): boolean => {
    const n = pool.get(id) ?? 0;
    if (n <= 0) return false;
    pool.set(id, n - 1);
    return true;
  };
  const visit = (id: string, depth: number, isRoot: boolean): RecipeNode => {
    const item = items[id];
    if (!item) throw new Error(`unknown item in recipe: ${id}`);
    if (depth > 8) throw new Error(`recipe cycle at ${id}`);
    // The root itself being owned doesn't cover a new purchase of it.
    if (!isRoot && take(id)) return { item, children: (item.components ?? []).map((c) => ownedSubtree(c, depth + 1)), owned: true };
    const children = (item.components ?? []).map((c) => visit(c, depth + 1, false));
    return { item, children, owned: children.length > 0 && children.every((c) => c.owned) };
  };
  const ownedSubtree = (id: string, depth: number): RecipeNode => {
    const item = items[id];
    if (!item) throw new Error(`unknown item in recipe: ${id}`);
    if (depth > 8) throw new Error(`recipe cycle at ${id}`);
    return { item, children: (item.components ?? []).map((c) => ownedSubtree(c, depth + 1)), owned: true };
  };
  return visit(itemId, 0, true);
};

/** Leaf items still to buy for this tree, in left-to-right order (what "buy missing parts" purchases). */
export const missingParts = (node: RecipeNode): ItemDef[] => {
  if (node.owned) return [];
  if (node.children.length === 0) return [node.item];
  return node.children.flatMap(missingParts);
};

/** Sum of leaf costs (= the item's full price when the data is consistent). */
export const treeCost = (node: RecipeNode): number =>
  node.children.length === 0 ? node.item.cost : node.children.reduce((s, c) => s + treeCost(c), 0);

/** Gold still needed to complete the item. */
export const remainingCost = (node: RecipeNode): number => missingParts(node).reduce((s, it) => s + it.cost, 0);

/** Items that use this one as a direct component ("builds into"). */
export const buildsInto = (itemId: string, items: Record<string, ItemDef>): ItemDef[] =>
  Object.values(items)
    .filter((it) => it.components?.includes(itemId))
    .sort((a, b) => a.cost - b.cost);

const STAT_LABEL: Record<keyof ItemDef['stats'], (v: number) => string> = {
  str: (v) => `+${v} Strength`,
  agi: (v) => `+${v} Agility`,
  int: (v) => `+${v} Intelligence`,
  damage: (v) => `+${v} Damage`,
  armor: (v) => `+${v} Armor`,
  attackSpeed: (v) => `+${Math.round(v * 100)} Attack Speed`,
  moveSpeed: (v) => `+${v} Move Speed`,
  hp: (v) => `+${v} HP`,
  mana: (v) => `+${v} Mana`,
  hpRegen: (v) => `+${v} HP Regen`,
  manaRegen: (v) => `+${Math.round(v * 100)}% Mana Regen`,
  attackRange: (v) => `+${v} Attack Range`,
};

/** Human-readable stat lines for the tooltip. */
export const statLines = (item: ItemDef): string[] =>
  (Object.keys(item.stats) as Array<keyof ItemDef['stats']>).map((k) => STAT_LABEL[k](item.stats[k]!));
