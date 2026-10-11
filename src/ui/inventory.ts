// Bottom-right: gold (reliable + unreliable, CS money flash on change) and the 6-slot inventory.
import { ABILITIES, ITEMS, levelValue } from '../data';
import type { HudContext, HudPart } from './context';
import { formatCooldown, formatGold } from './format';
import { GLYPHS, itemIconUrl } from './icons';
import { el, setText } from './style';

export const createGoldInventory = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const root = el('div', 'hud-goldinv');
  const gold = el('div', 'hud-gold');
  gold.innerHTML = `${GLYPHS.coin}<span class="hud-num hud-gold-num">0</span><span class="hud-gold-delta"></span>`;
  const split = el('div', 'hud-gold-split');
  const inv = el('div', 'hud-inv');
  const slots = Array.from({ length: 6 }, () => {
    const s = el('div', 'slot');
    const cd = el('div', 'cd');
    const t = el('div', 't');
    const n = el('div', 'n');
    s.append(cd, t, n);
    inv.appendChild(s);
    return { s, cd, t, n, item: '' as string, key: '' };
  });
  root.append(gold, split, inv);
  parent.appendChild(root);

  const goldNum = gold.querySelector('.hud-gold-num')!;
  const delta = gold.querySelector<HTMLElement>('.hud-gold-delta')!;
  let flashUntil = 0;
  let lastSplit = '';
  let pendingDelta = 0;
  let deltaAt = -1;

  const playerId = (): number => ctx.sim.player().id;
  const off = ctx.events.on('gold:changed', (e) => {
    if (e.unitId !== playerId() || e.delta === 0) return;
    pendingDelta += e.delta;
    deltaAt = ctx.now();
  });

  return {
    update() {
      const h = ctx.sim.player().hero;
      if (!h) return;
      const now = ctx.now();
      setText(goldNum, formatGold(h.reliableGold + h.unreliableGold));
      const s = `<b>${formatGold(h.reliableGold)}</b> reliable · <b>${formatGold(h.unreliableGold)}</b> unreliable`;
      if (s !== lastSplit) {
        lastSplit = s;
        split.innerHTML = s;
      }
      // Batch deltas from the same frame window into one floating number (bounty + passive gold).
      if (deltaAt >= 0 && now - deltaAt > 0.05) {
        const d = Math.round(pendingDelta);
        if (Math.abs(d) >= 2) {
          delta.textContent = `${d > 0 ? '+' : ''}${d}`;
          delta.classList.toggle('neg', d < 0);
          delta.classList.remove('show');
          void delta.offsetWidth;
          delta.classList.add('show');
          gold.classList.toggle('gain', d > 0);
          gold.classList.toggle('loss', d < 0);
          flashUntil = now + 0.25;
        }
        pendingDelta = 0;
        deltaAt = -1;
      }
      if (flashUntil > 0 && now > flashUntil) {
        flashUntil = 0;
        gold.classList.remove('gain', 'loss');
      }

      const time = ctx.sim.time;
      for (let i = 0; i < 6; i++) {
        const v = slots[i]!;
        const id = h.items[i] ?? '';
        if (id !== v.item) {
          v.item = id;
          const item = id ? ITEMS[id] : undefined;
          v.s.style.backgroundImage = item ? `url(${itemIconUrl(item, 64)})` : '';
          v.s.title = item ? item.name : '';
        }
        const item = id ? ITEMS[id] : undefined;
        let p = 0;
        let txt = '';
        if (item?.active) {
          const ab = ABILITIES[item.active];
          const rem = Math.max(0, (h.cooldownReadyAt[item.active] ?? -Infinity) - time);
          if (ab && rem > 0) {
            p = Math.min(1, rem / Math.max(0.01, levelValue(ab, 'cooldown', 1)));
            txt = formatCooldown(rem);
          }
        }
        const charges = item?.charges && item.active ? (h.charges[item.active] ?? item.charges) : 0;
        const key = `${p.toFixed(2)}|${txt}|${charges}`;
        if (key !== v.key) {
          v.key = key;
          v.cd.style.setProperty('--p', p.toFixed(3));
          setText(v.t, txt);
          setText(v.n, charges > 1 ? String(charges) : '');
        }
      }
    },
    dispose() {
      off();
      root.remove();
    },
  };
};
