// Top centre: hero portraits per team, Sentinel vs Scourge hero kills, match clock and day/night.
import type { UnitState } from '../core/sim';
import type { HudContext, HudPart } from './context';
import { formatClock, formatSeconds } from './format';
import { GLYPHS, heroColor, heroInitials } from './icons';
import { el, setText } from './style';

interface Portrait {
  unitId: number;
  root: HTMLElement;
  rs: HTMLElement;
  key: string;
}

export const createTopBar = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const root = el('div', 'hud-top');
  const sen = el('div', 'team sen');
  const sco = el('div', 'team sco');
  const senScore = el('div', 'hud-score sen', '0');
  const scoScore = el('div', 'hud-score sco', '0');
  const clock = el('div', 'hud-clock');
  clock.innerHTML = `<div class="t">0:00</div><div class="dn"><span class="ico"></span><span class="lbl"></span></div><div class="phase"><i></i></div>`;
  root.append(sen, senScore, clock, scoScore, sco);
  parent.appendChild(root);
  const clockT = clock.querySelector('.t')!;
  const dnIco = clock.querySelector('.ico')!;
  const dnLbl = clock.querySelector('.lbl')!;
  const phase = clock.querySelector<HTMLElement>('.phase i')!;

  const portraits = new Map<number, Portrait>();
  let rosterKey = '';
  let lastDay: boolean | null = null;
  let lastPhase = -1;

  const buildRoster = (heroes: readonly UnitState[]): void => {
    sen.textContent = '';
    sco.textContent = '';
    portraits.clear();
    for (const u of heroes) {
      const p = el('div', 'hud-portrait');
      p.style.background = `linear-gradient(${heroColor(u.def.id)}, #111)`;
      p.textContent = heroInitials(u.def.name);
      p.title = u.def.name;
      const rs = el('span', 'rs');
      p.appendChild(rs);
      if (u.hero?.isPlayer) p.classList.add('me');
      (u.team === 'sentinel' ? sen : sco).appendChild(p);
      portraits.set(u.id, { unitId: u.id, root: p, rs, key: '' });
    }
  };

  return {
    update() {
      const sim = ctx.sim;
      const heroes = sim.units().filter((u) => u.hero && u.team !== 'neutral');
      const key = heroes.map((h) => h.id).join(',');
      if (key !== rosterKey) {
        rosterKey = key;
        buildRoster(heroes);
      }
      let kSen = 0;
      let kSco = 0;
      for (const u of heroes) {
        const h = u.hero!;
        if (u.team === 'sentinel') kSen += h.kills;
        else kSco += h.kills;
        const p = portraits.get(u.id);
        if (!p) continue;
        const dead = !u.alive;
        const rs = dead && h.respawnAt !== null ? formatSeconds(h.respawnAt - sim.time) : '';
        const unseen = !dead && u.team !== ctx.team && !sim.isVisibleTo(ctx.team, u.id);
        const pk = `${dead}|${rs}|${unseen}`;
        if (pk !== p.key) {
          p.key = pk;
          p.root.classList.toggle('dead', dead);
          p.root.classList.toggle('unseen', unseen);
          setText(p.rs, rs);
        }
      }
      setText(senScore, String(kSen));
      setText(scoScore, String(kSco));
      setText(clockT, formatClock(sim.time));
      const day = sim.isDay;
      if (day !== lastDay) {
        lastDay = day;
        dnIco.innerHTML = day ? GLYPHS.sun : GLYPHS.moon;
        dnLbl.textContent = day ? 'Day' : 'Night';
        clock.classList.toggle('night', !day);
      }
      // timeOfDay is the 0..1 cycle; the bar shows progress through the current half (day or night).
      const half = (sim.timeOfDay * 2) % 1;
      if (Math.abs(half - lastPhase) > 0.004) {
        lastPhase = half;
        phase.style.transform = `scaleX(${half.toFixed(3)})`;
      }
    },
    dispose() {
      root.remove();
    },
  };
};
