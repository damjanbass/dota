// Tab scoreboard (CS 1.6 layout): both teams' heroes with level, K/D/A, LH/DN, gold (allies only),
// items and respawn timers.
import type { UnitState } from '../core/sim';
import type { Team } from '../core/types';
import { ITEMS } from '../data';
import type { HudContext, HudPart } from './context';
import { formatClock, formatGold, formatSeconds } from './format';
import { heroColor, heroInitials, itemIconUrl } from './icons';
import { el, esc } from './style';

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

export interface ScoreboardPart extends HudPart {
  setOpen(open: boolean): void;
  readonly open: boolean;
}

/** Scoreboard rows: heroes of a team, the player first, then by kills. */
export const scoreRows = (units: readonly UnitState[], team: Team): UnitState[] =>
  units
    .filter((u) => u.hero && u.team === team)
    .sort((a, b) => Number(b.hero!.isPlayer) - Number(a.hero!.isPlayer) || b.hero!.kills - a.hero!.kills || a.id - b.id);

export const createScoreboard = (ctx: HudContext, parent: HTMLElement): ScoreboardPart => {
  const root = el('div', 'hud-score-panel');
  parent.appendChild(root);
  let open = false;
  let acc = 1;
  let lastHtml = '';

  const itemsHtml = (u: UnitState, show: boolean): string => {
    const cells = (u.hero?.items ?? []).map((id) => {
      const item = id && show ? ITEMS[id] : undefined;
      return item ? `<i title="${esc(item.name)}" style="background-image:url(${itemIconUrl(item, 32)})"></i>` : '<i></i>';
    });
    return `<div class="items">${cells.join('')}</div>`;
  };

  const teamTable = (team: Team): string => {
    const sim = ctx.sim;
    const ally = team === ctx.team;
    const rows = scoreRows(sim.units(), team);
    const kills = rows.reduce((s, u) => s + u.hero!.kills, 0);
    const label = team === 'sentinel' ? 'The Sentinel' : 'The Scourge';
    const body = rows
      .map((u) => {
        const h = u.hero!;
        const seen = ally || sim.isVisibleTo(ctx.team, u.id);
        const dead = !u.alive;
        const rs = dead && h.respawnAt !== null ? `<span class="rs">${formatSeconds(h.respawnAt - sim.time)}s</span>` : u.alive ? '' : '—';
        const name = `<span class="pt" style="background:linear-gradient(${heroColor(u.def.id)},#111)">${heroInitials(u.def.name)}</span>${esc(u.def.name)}${h.isPlayer ? ' <b>(You)</b>' : ''}`;
        const gold = ally ? formatGold(h.reliableGold + h.unreliableGold) : '—';
        return `<tr class="${h.isPlayer ? 'me' : ''}${dead ? ' dead' : ''}"><td>${name}</td><td class="num">${h.level}</td><td class="num">${h.kills} / ${h.deaths} / ${h.assists}</td><td class="num">${h.lastHits} / ${h.denies}</td><td class="num">${gold}</td><td>${itemsHtml(u, seen)}</td><td class="num">${rs}</td></tr>`;
      })
      .join('');
    return `<table class="${team}"><thead><tr><th class="team">${label} — ${kills}</th><th class="num">Lvl</th><th class="num">K / D / A</th><th class="num">LH / DN</th><th class="num">Gold</th><th>Items</th><th class="num">Respawn</th></tr></thead><tbody>${body}</tbody></table>`;
  };

  const render = (): void => {
    const sim = ctx.sim as typeof ctx.sim & { config?: { difficulty?: keyof typeof DIFFICULTY_LABEL } };
    const diff = sim.config?.difficulty ? ` · ${DIFFICULTY_LABEL[sim.config.difficulty]} bots` : '';
    const html = `<h2>DotA Allstars 6.83d <small>${formatClock(sim.time)}${diff}</small></h2>${teamTable('sentinel')}${teamTable('scourge')}`;
    if (html !== lastHtml) {
      lastHtml = html;
      root.innerHTML = html;
    }
  };

  return {
    get open() {
      return open;
    },
    setOpen(v: boolean) {
      if (v === open) return;
      open = v;
      root.classList.toggle('on', v);
      if (v) {
        acc = 1;
        render();
      }
    },
    update(frameDt) {
      if (!open) return;
      acc += frameDt;
      if (acc < 0.25) return;
      acc = 0;
      render();
    },
    dispose() {
      root.remove();
    },
  };
};
