// Shops: buying requires a matching shop entity nearby (base shops are per team), enough gold and a free slot.
// Buying a completed item uses owned components and buys the missing ones; buying a component auto-combines any
// recipe whose parts are all in the inventory (DotA behaviour).
import { entitiesOfKind } from '../core/map';
import type { MapEntityKind } from '../core/map';
import type { ItemDef } from '../core/types';
import { ABILITIES, ITEMS } from '../data';
import { spendGold, totalGold } from './economy';
import { TUNABLES } from './tunables';
import type { SimHero, SimUnit } from './types';
import type { World } from './world';

type BuyResult = { ok: true } | { ok: false; reason: string };

const SHOP_KIND: Record<ItemDef['shop'], MapEntityKind> = { base: 'shop', secret: 'secret_shop', side: 'side_shop' };

const COMPOSITES: readonly ItemDef[] = Object.values(ITEMS).filter((i) => i.components && i.components.length > 0);

/** Consumables: an active and no stats or components (TP, Salve, Clarity, Tango). Charges from the item or its ability. */
export const itemCharges = (item: ItemDef): number => {
  if (!item.active || item.components || Object.keys(item.stats).length > 0) return 0;
  return item.charges ?? ABILITIES[item.active]?.values.charges?.[0] ?? 1;
};

export const nearShop = (w: World, u: SimUnit, item: ItemDef): boolean => {
  const kind = SHOP_KIND[item.shop];
  const r2 = TUNABLES.shopRadius * TUNABLES.shopRadius;
  return entitiesOfKind(w.map, kind).some((e) => {
    if (kind === 'shop' && e.team !== u.team) return false;
    const dx = e.x - u.position.x;
    const dy = e.y - u.position.y;
    return dx * dx + dy * dy <= r2;
  });
};

/** Uses an owned copy of `id` (removing it from `inv`) or buys it (recursively for composites). Returns gold spent. */
const acquire = (inv: string[], id: string): number => {
  const i = inv.indexOf(id);
  if (i >= 0) {
    inv.splice(i, 1);
    return 0;
  }
  const item = ITEMS[id];
  if (!item) return Infinity;
  if (!item.components || item.components.length === 0) return item.cost;
  let cost = 0;
  for (const c of item.components) cost += acquire(inv, c);
  return cost;
};

/** Combines every completed recipe in `inv` (repeat until stable). */
const autoCombine = (inv: string[]): void => {
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of COMPOSITES) {
      const parts = r.components!;
      const copy = [...inv];
      let ok = true;
      for (const p of parts) {
        const i = copy.indexOf(p);
        if (i < 0) {
          ok = false;
          break;
        }
        copy.splice(i, 1);
      }
      if (!ok) continue;
      copy.push(r.id);
      inv.length = 0;
      inv.push(...copy);
      changed = true;
      break;
    }
  }
};

export const buyItem = (w: World, unitId: number, itemId: string): BuyResult => {
  const u = w.byId.get(unitId);
  const h = u?.hero as SimHero | undefined;
  if (!u || !h) return { ok: false, reason: 'not a hero' };
  if (!u.alive) return { ok: false, reason: 'dead' };
  const item = ITEMS[itemId];
  if (!item) return { ok: false, reason: 'unknown item' };
  if (!nearShop(w, u, item)) return { ok: false, reason: 'no shop nearby' };

  // Plan on a copy of the inventory: charges travel with untouched slots.
  const slots = h.items.map((id, i) => (id ? { id, charges: h.itemCharges[i] ?? 0 } : null));
  const inv = slots.filter((s): s is { id: string; charges: number } => s !== null).map((s) => s.id);
  let cost: number;
  if (item.components && item.components.length > 0) {
    cost = 0;
    for (const c of item.components) cost += acquire(inv, c);
    inv.push(item.id);
  } else {
    cost = item.cost;
    inv.push(item.id);
  }
  autoCombine(inv);
  if (!Number.isFinite(cost)) return { ok: false, reason: 'unknown component' };
  if (inv.length > h.items.length) return { ok: false, reason: 'inventory full' };
  if (totalGold(u) < cost) return { ok: false, reason: 'not enough gold' };

  spendGold(w, u, cost, 'purchase');
  // Rebuild slots: keep surviving items in their slots (with charges), put new ones in free slots.
  const remaining = [...inv];
  const next: Array<{ id: string; charges: number } | null> = slots.map((s) => {
    if (!s) return null;
    const i = remaining.indexOf(s.id);
    if (i < 0) return null;
    remaining.splice(i, 1);
    return s;
  });
  for (const id of remaining) {
    const free = next.findIndex((s) => s === null);
    next[free] = { id, charges: itemCharges(ITEMS[id]!) };
  }
  for (let i = 0; i < h.items.length; i++) {
    h.items[i] = next[i]?.id ?? null;
    h.itemCharges[i] = next[i]?.charges ?? 0;
  }
  w.markDirty(u);
  w.unitStats(u);
  w.events.emit('item:bought', { unitId: u.id, itemId });
  return { ok: true };
};
