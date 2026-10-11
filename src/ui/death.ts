// Death screen: grey-out, "You were killed by X", respawn countdown and buyback (button + key).
import { buybackCost } from '../data';
import type { HudContext, HudPart } from './context';
import { formatGold, formatSeconds } from './format';
import { el, esc, setText } from './style';

/** Buyback key (KeyboardEvent.code). Not part of the player's Input bindings, so the HUD owns it. */
export const BUYBACK_CODE = 'KeyY';

export interface DeathPart extends HudPart {
  readonly shown: boolean;
}

export const createDeathScreen = (ctx: HudContext, parent: HTMLElement): DeathPart => {
  const root = el('div', 'hud-death');
  root.innerHTML = `
    <div class="killed"></div>
    <div class="sub">Respawn in</div>
    <div class="timer">0</div>
    <button class="wc-btn bb"></button>
    <div class="msg hint"></div>
    <div class="hint">Press <kbd>Y</kbd> to buy back · <kbd>Esc</kbd> frees the mouse</div>`;
  parent.appendChild(root);
  const killed = root.querySelector<HTMLElement>('.killed')!;
  const timer = root.querySelector('.timer')!;
  const btn = root.querySelector<HTMLButtonElement>('.bb')!;
  const msg = root.querySelector('.msg')!;
  let shown = false;
  let killer = '';
  let lastBtn = '';

  const tryBuyback = (): void => {
    const p = ctx.sim.player();
    if (p.alive) return;
    const ok = ctx.sim.buyback(p.id);
    msg.textContent = ok ? '' : 'Buyback not available';
  };

  btn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    tryBuyback();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (shown && e.code === BUYBACK_CODE && !e.repeat) tryBuyback();
  };
  window.addEventListener('keydown', onKey);

  const off = ctx.events.on('unit:died', (e) => {
    if (e.unitId !== ctx.sim.player().id) return;
    const k = e.killerId !== null ? ctx.sim.get(e.killerId) : undefined;
    killer = k ? ctx.unitName(k) : '';
  });

  return {
    get shown() {
      return shown;
    },
    update() {
      const p = ctx.sim.player();
      const h = p.hero;
      const dead = !p.alive;
      if (dead !== shown) {
        shown = dead;
        root.classList.toggle('on', dead);
        msg.textContent = '';
        killed.innerHTML = killer ? `You were killed by <b>${esc(killer)}</b>` : 'You died';
      }
      if (!dead || !h) return;
      setText(timer, h.respawnAt !== null ? formatSeconds(h.respawnAt - ctx.sim.time) : '—');
      const cost = buybackCost(h.level, ctx.sim.time);
      const gold = h.reliableGold + h.unreliableGold;
      const label = `Buyback — ${formatGold(cost)} gold`;
      const key = `${label}|${gold >= cost}`;
      if (key !== lastBtn) {
        lastBtn = key;
        btn.textContent = label;
        btn.disabled = gold < cost;
      }
    },
    dispose() {
      off();
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
};
