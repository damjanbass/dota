// B shop: DotA shop tabs, item cards with costs, recipe trees, "near shop" status and purchase errors.
// Buys only through sim.buyItem; the sim decides what is legal and returns the reason when it isn't.
import { entitiesOfKind } from '../core/map';
import type { ItemDef, Team } from '../core/types';
import { ABILITIES, ITEMS, ITEM_PASSIVES } from '../data';
import type { HudContext, HudPart } from './context';
import { formatGold } from './format';
import { GLYPHS, itemIconUrl } from './icons';
import { buildRecipeTree, buildShopGroups, buildsInto, missingParts, remainingCost, statLines } from './shopData';
import type { RecipeNode, ShopGroup, ShopGroupId } from './shopData';
import { el, esc } from './style';

/**
 * UI-only hint radius for "you are near a shop". The sim's buyItem is authoritative (see
 * CONTRACT_REQUESTS.md H2: a sim-side shop-range query would replace this).
 */
export const SHOP_HINT_RANGE = 600;

export type ShopKind = 'base' | 'secret' | 'side';

/** Shop kinds within range of (x, y) for a team, from map entities. Pure. */
export const shopsNear = (ctx: Pick<HudContext, 'map'>, team: Team, x: number, y: number, range = SHOP_HINT_RANGE): Set<ShopKind> => {
  const out = new Set<ShopKind>();
  const near = (ex: number, ey: number): boolean => Math.hypot(ex - x, ey - y) <= range;
  if (entitiesOfKind(ctx.map, 'shop', team).some((e) => near(e.x, e.y))) out.add('base');
  if (entitiesOfKind(ctx.map, 'secret_shop').some((e) => near(e.x, e.y))) out.add('secret');
  if (entitiesOfKind(ctx.map, 'side_shop').some((e) => near(e.x, e.y))) out.add('side');
  return out;
};

export interface ShopPart extends HudPart {
  readonly open: boolean;
  setOpen(open: boolean): void;
  select(itemId: string): void;
}

export const createShop = (ctx: HudContext, parent: HTMLElement, onClose: () => void): ShopPart => {
  const groups: ShopGroup[] = buildShopGroups(ITEMS);
  const root = el('div', 'hud-shop wc-panel');
  root.innerHTML = `
    <header><h2>Shop</h2><div class="gold">${GLYPHS.coin}<span class="g">0</span></div></header>
    <div class="near"></div>
    <div class="body"><nav></nav><div class="grid"></div><div class="detail"></div></div>
    <footer><kbd>B</kbd> / <kbd>Esc</kbd> close · click an item to see it, <b>Buy</b> or double-click to purchase · right-click buys instantly</footer>`;
  parent.appendChild(root);
  const goldEl = root.querySelector('.g')!;
  const nearEl = root.querySelector<HTMLElement>('.near')!;
  const nav = root.querySelector<HTMLElement>('nav')!;
  const grid = root.querySelector<HTMLElement>('.grid')!;
  const detail = root.querySelector<HTMLElement>('.detail')!;

  let open = false;
  let tab: ShopGroupId = 'consumables';
  let selected = 'tpscroll';
  let message = '';
  let messageOk = false;
  let lastKey = '';
  let acc = 1;

  // Stop clicks from reaching the canvas (which would grab pointer lock).
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const hero = () => ctx.sim.player().hero!;

  const buy = (itemId: string): boolean => {
    const item = ITEMS[itemId];
    const res = ctx.sim.buyItem(ctx.sim.player().id, itemId);
    if (res.ok) {
      message = `Bought ${item?.name ?? itemId}`;
      messageOk = true;
    } else {
      message = res.reason;
      messageOk = false;
    }
    lastKey = '';
    render();
    return res.ok;
  };

  const buyMissing = (itemId: string): void => {
    const tree = buildRecipeTree(itemId, ITEMS, hero().items);
    const parts = missingParts(tree);
    if (!parts.length) {
      buy(itemId);
      return;
    }
    for (const p of parts) if (!buy(p.id)) return;
  };

  const renderNav = (): void => {
    nav.innerHTML = groups.map((g) => `<button data-tab="${g.id}" class="${g.id === tab ? 'on' : ''}">${esc(g.label)}<small>${esc(g.shopName)}</small></button>`).join('');
  };

  nav.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as ShopGroupId;
    renderNav();
    lastKey = '';
    render();
  });

  const onItemClick = (e: MouseEvent): void => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
    if (!card) return;
    const id = card.dataset.item!;
    if (e.type === 'dblclick') buy(id);
    else {
      selected = id;
      lastKey = '';
      render();
    }
  };
  grid.addEventListener('click', onItemClick);
  grid.addEventListener('dblclick', onItemClick);
  grid.addEventListener('contextmenu', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
    if (card) buy(card.dataset.item!);
  });
  detail.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const action = t.closest<HTMLElement>('[data-act]');
    if (action) {
      if (action.dataset.act === 'buy') buy(selected);
      else if (action.dataset.act === 'missing') buyMissing(selected);
      return;
    }
    const node = t.closest<HTMLElement>('[data-item]');
    if (node) {
      selected = node.dataset.item!;
      lastKey = '';
      render();
    }
  });

  const treeHtml = (n: RecipeNode, root = true): string => {
    const head = `<div class="node${n.owned ? ' owned' : ''}" data-item="${n.item.id}"><img src="${itemIconUrl(n.item, 32)}" alt="">${esc(n.item.name)}<span class="c">${formatGold(n.item.cost)}</span></div>`;
    if (!n.children.length) return head;
    const kids = `<div class="kids">${n.children.map((c) => treeHtml(c, false)).join('')}</div>`;
    return root ? `${head}${kids}` : `<div>${head}${kids}</div>`;
  };

  const renderDetail = (item: ItemDef, gold: number): string => {
    const tree = buildRecipeTree(item.id, ITEMS, hero().items);
    const remaining = remainingCost(tree);
    const stats = statLines(item);
    const passives = [...(item.passives ?? []), ...(ITEM_PASSIVES[item.id] ?? [])];
    const abil = [item.active ? ABILITIES[item.active] : undefined, ...passives.map((p) => ABILITIES[p])].filter((a, i, arr) => a && arr.indexOf(a) === i);
    const into = buildsInto(item.id, ITEMS);
    const composite = !!item.components?.length;
    const shopNote = item.shop === 'secret' ? 'Sold at the Secret Shop' : item.shop === 'side' ? 'Sold at the side shop' : 'Sold at your base shop';
    return `
      <h3><img src="${itemIconUrl(item, 64)}" alt="">${esc(item.name)}</h3>
      <div class="cost">${formatGold(item.cost)} gold${composite && remaining !== item.cost ? ` · ${formatGold(remaining)} to complete` : ''}</div>
      ${stats.length ? `<ul>${stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${abil.map((a) => `<p><b>${esc(a!.name)}</b> — ${esc(a!.description)}</p>`).join('')}
      <p class="menu-note">${shopNote}${item.charges ? ` · ${item.charges} charges` : ''}</p>
      ${composite ? `<div class="label">Recipe</div><div class="tree">${treeHtml(tree)}</div>` : ''}
      ${into.length ? `<div class="label">Builds into</div><div class="tree">${into.map((i) => `<div class="node" data-item="${i.id}"><img src="${itemIconUrl(i, 32)}" alt="">${esc(i.name)}<span class="c">${formatGold(i.cost)}</span></div>`).join('')}</div>` : ''}
      <div class="buy">
        <button class="wc-btn" data-act="buy" ${gold < item.cost ? 'disabled' : ''}>Buy ${formatGold(item.cost)}</button>
        ${composite && missingParts(tree).length > 1 ? `<button class="wc-btn small" data-act="missing">Buy missing parts</button>` : ''}
      </div>
      <div class="msg${messageOk ? ' ok' : ''}">${esc(message)}</div>`;
  };

  const render = (): void => {
    if (!open) return;
    const u = ctx.sim.player();
    const h = u.hero!;
    const gold = h.reliableGold + h.unreliableGold;
    const near = shopsNear(ctx, u.team, u.position.x, u.position.y);
    const key = `${tab}|${selected}|${Math.floor(gold)}|${h.items.join(',')}|${[...near].join(',')}|${message}`;
    if (key === lastKey) return;
    lastKey = key;
    goldEl.textContent = formatGold(gold);
    const tag = (k: ShopKind, label: string): string => `<span class="${near.has(k) ? 'ok' : ''}">${near.has(k) ? '✔' : '✖'} ${label}</span>`;
    nearEl.innerHTML = `${tag('base', 'Base shop')}${tag('secret', 'Secret shop')}${tag('side', 'Side shop')}${near.size ? '' : '<span>Walk to a shop to buy</span>'}`;
    const g = groups.find((x) => x.id === tab)!;
    grid.innerHTML = g.items
      .map(
        (it) =>
          `<div class="card${it.id === selected ? ' sel' : ''}${gold < it.cost ? ' poor' : ''}" data-item="${it.id}" title="${esc(it.name)}"><img src="${itemIconUrl(it, 64)}" alt=""><span>${esc(it.name)}</span><span class="c">${formatGold(it.cost)}</span></div>`,
      )
      .join('');
    const item = ITEMS[selected];
    detail.innerHTML = item ? renderDetail(item, gold) : '';
  };

  renderNav();
  const onKey = (e: KeyboardEvent): void => {
    if (!open || e.code !== 'Escape') return;
    e.preventDefault();
    onClose();
  };
  window.addEventListener('keydown', onKey);

  return {
    get open() {
      return open;
    },
    setOpen(v: boolean) {
      if (v === open) return;
      open = v;
      root.classList.toggle('on', v);
      if (v) {
        message = '';
        lastKey = '';
        render();
      }
    },
    select(itemId: string) {
      const item = ITEMS[itemId];
      if (!item) return;
      selected = itemId;
      tab = groups.find((g) => g.items.includes(item))?.id ?? tab;
      renderNav();
      lastKey = '';
      render();
    },
    update(frameDt) {
      if (!open) return;
      acc += frameDt;
      if (acc < 0.2) return;
      acc = 0;
      render();
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
};
