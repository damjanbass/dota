// Bottom-left: CS-style HP and MP numerals with bars, plus the hero level badge with an XP ring.
import { HERO_XP } from '../data';
import type { HudContext, HudPart } from './context';
import { xpProgress } from './format';
import { GLYPHS } from './icons';
import { el, setText } from './style';

const LOW_HP = 0.25;

export const createStatus = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const root = el('div', 'hud-status');
  const lvl = el('div', 'hud-lvl');
  const ring = el('canvas');
  ring.width = 128;
  ring.height = 128;
  const lvlNum = el('b');
  const lvlLabel = el('small', '', 'LEVEL');
  lvl.append(ring, lvlNum, lvlLabel);

  const hp = el('div', 'hud-stat hp');
  hp.innerHTML = `<div class="row">${GLYPHS.cross}<span class="hud-num hud-hp-num"></span><span class="max"></span></div><div class="hud-bar"><i></i></div>`;
  const mp = el('div', 'hud-stat mp');
  mp.innerHTML = `<div class="row">${GLYPHS.mana}<span class="hud-num hud-mp-num"></span><span class="max"></span></div><div class="hud-bar mp"><i></i></div>`;
  root.append(lvl, hp, mp);
  parent.appendChild(root);

  const hpNum = hp.querySelector('.hud-hp-num')!;
  const hpMax = hp.querySelector('.max')!;
  const hpBar = hp.querySelector<HTMLElement>('.hud-bar > i')!;
  const mpNum = mp.querySelector('.hud-mp-num')!;
  const mpMax = mp.querySelector('.max')!;
  const mpBar = mp.querySelector<HTMLElement>('.hud-bar > i')!;
  const g = ring.getContext('2d')!;

  let lastXpKey = '';
  let lastHpFrac = -1;
  let lastMpFrac = -1;
  let lastLow: boolean | null = null;

  const drawRing = (level: number, frac: number): void => {
    const s = 128;
    g.clearRect(0, 0, s, s);
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.beginPath();
    g.arc(s / 2, s / 2, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(16,12,6,0.85)';
    g.beginPath();
    g.arc(s / 2, s / 2, 49, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#b88cff';
    g.shadowColor = '#b88cff';
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(s / 2, s / 2, 54, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = '#b58c3c';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(s / 2, s / 2, 60, 0, Math.PI * 2);
    g.stroke();
    setText(lvlNum, String(level));
  };

  return {
    update() {
      const u = ctx.sim.player();
      const h = u.hero;
      setText(hpNum, String(Math.max(0, Math.ceil(u.hp))));
      setText(hpMax, `/ ${Math.round(u.maxHp)}`);
      setText(mpNum, String(Math.max(0, Math.floor(u.mana))));
      setText(mpMax, `/ ${Math.round(u.maxMana)}`);
      const hf = u.maxHp > 0 ? Math.max(0, u.hp / u.maxHp) : 0;
      const mf = u.maxMana > 0 ? Math.max(0, u.mana / u.maxMana) : 0;
      if (Math.abs(hf - lastHpFrac) > 0.002) {
        lastHpFrac = hf;
        hpBar.style.transform = `scaleX(${hf.toFixed(3)})`;
      }
      if (Math.abs(mf - lastMpFrac) > 0.002) {
        lastMpFrac = mf;
        mpBar.style.transform = `scaleX(${mf.toFixed(3)})`;
      }
      const low = u.alive && hf < LOW_HP;
      if (low !== lastLow) {
        lastLow = low;
        root.classList.toggle('low', low);
      }
      if (h) {
        const frac = xpProgress(h.xp, h.level, HERO_XP.totalXpForLevel);
        const key = `${h.level}:${frac.toFixed(3)}`;
        if (key !== lastXpKey) {
          lastXpKey = key;
          drawRing(h.level, frac);
        }
      }
    },
    dispose() {
      root.remove();
    },
  };
};
