// VICTORY / DEFEAT screen with match stats. Used by createMenus().showEnd() and the HUD on match:ended.
import type { SimApi } from '../core/sim';
import type { Team } from '../core/types';
import { formatClock, formatGold } from './format';
import { heroColor, heroInitials } from './icons';
import { ensureStyles, el, esc } from './style';

export interface EndHeroStats {
  heroId: string;
  name: string;
  team: Team;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  gold: number;
  isPlayer: boolean;
}

export interface EndStats {
  /** Match clock at the end (seconds since the horn). */
  time: number;
  heroes: EndHeroStats[];
}

export const collectEndStats = (sim: SimApi): EndStats => ({
  time: sim.time,
  heroes: sim
    .units()
    .filter((u) => u.hero)
    .map((u) => {
      const h = u.hero!;
      return {
        heroId: u.def.id,
        name: u.def.name,
        team: u.team,
        level: h.level,
        kills: h.kills,
        deaths: h.deaths,
        assists: h.assists,
        lastHits: h.lastHits,
        denies: h.denies,
        gold: h.reliableGold + h.unreliableGold,
        isPlayer: h.isPlayer,
      };
    })
    .sort((a, b) => (a.team === b.team ? Number(b.isPlayer) - Number(a.isPlayer) || b.kills - a.kills : a.team === 'sentinel' ? -1 : 1)),
});

/** Which ancient fell, from the player's point of view (player team is Sentinel). */
export const endReason = (winner: Team): string =>
  winner === 'sentinel' ? 'The Frozen Throne has been destroyed.' : winner === 'scourge' ? 'The World Tree has been destroyed.' : 'The match is over.';

/** Shows the end screen inside `parent`; resolves when the player leaves it. */
export const showEndScreen = (parent: HTMLElement, winner: Team, stats: EndStats | null, playerTeam: Team = 'sentinel'): Promise<void> => {
  ensureStyles();
  if (document.pointerLockElement) document.exitPointerLock();
  const win = winner === playerTeam;
  const root = el('div', `ui-end menu-root ${win ? 'win' : 'lose'}`);
  const me = stats?.heroes.find((h) => h.isPlayer);
  const rows = (stats?.heroes ?? [])
    .map(
      (h) =>
        `<tr class="${h.team}${h.isPlayer ? ' me' : ''}"><td><span class="pt" style="display:inline-flex;width:22px;height:16px;align-items:center;justify-content:center;margin-right:6px;font:900 9px Verdana;color:#fff;background:linear-gradient(${heroColor(h.heroId)},#111)">${heroInitials(h.name)}</span>${esc(h.name)}${h.isPlayer ? ' (You)' : ''}</td><td>${h.team === 'sentinel' ? 'Sentinel' : 'Scourge'}</td><td>${h.level}</td><td>${h.kills} / ${h.deaths} / ${h.assists}</td><td>${h.lastHits} / ${h.denies}</td><td>${h.team === playerTeam ? formatGold(h.gold) : '—'}</td></tr>`,
    )
    .join('');
  root.innerHTML = `
    <h1>${win ? 'VICTORY' : 'DEFEAT'}</h1>
    <div class="why">${esc(endReason(winner))}</div>
    ${
      me && stats
        ? `<div class="facts"><div><b>${formatClock(stats.time)}</b>Match length</div><div><b>${me.kills}/${me.deaths}/${me.assists}</b>K / D / A</div><div><b>${me.lastHits}</b>Last hits</div><div><b>${me.denies}</b>Denies</div><div><b>${me.level}</b>Level</div></div>`
        : ''
    }
    ${rows ? `<table><thead><tr><th>Hero</th><th>Team</th><th>Lvl</th><th>K / D / A</th><th>LH / DN</th><th>Gold</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <button class="wc-btn primary">Main Menu</button>`;
  parent.appendChild(root);
  return new Promise<void>((resolve) => {
    root.querySelector('button')!.addEventListener('click', () => {
      root.remove();
      resolve();
    });
  });
};
