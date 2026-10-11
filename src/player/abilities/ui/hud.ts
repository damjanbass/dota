// Small ability-specific HUD bits: Shrapnel charge pips under the crosshair (with the restore timer when the sim
// exposes it), the click-to-confirm hint, toasts for refused casts, and the Assassinate screen flash.
import type { SimApi } from '../../../core/sim';
import { SNIPER_SHRAPNEL, levelValue } from '../../../data';
import { SHRAPNEL, skillLevel } from '../ids';
import type { KitLogic } from '../kitLogic';

interface ChargeTimers {
  chargeRestoreAt?: Record<string, number>;
}

export class KitHud {
  private readonly pips: HTMLDivElement;
  private readonly pipEls: HTMLElement[] = [];
  private readonly armed: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private toastTime = Infinity;
  private shown = '';

  constructor(root: HTMLElement) {
    this.pips = document.createElement('div');
    this.pips.className = 'kit-pips off';
    this.pips.innerHTML = '<b>Q</b>';
    this.armed = document.createElement('div');
    this.armed.className = 'kit-armed off';
    this.armed.textContent = 'SHRAPNEL · LMB fire · RMB cancel';
    this.toast = document.createElement('div');
    this.toast.className = 'kit-toast';
    this.flash = document.createElement('div');
    this.flash.className = 'kit-flash';
    root.append(this.flash, this.pips, this.armed, this.toast);
  }

  message(text: string, tone: 'error' | 'info'): void {
    this.toast.textContent = text;
    this.toast.className = `kit-toast show ${tone}`;
    this.toastTime = 0;
  }

  screenFlash(): void {
    this.flash.classList.remove('show');
    void this.flash.offsetWidth; // restart the animation
    this.flash.classList.add('show');
  }

  update(frameDt: number, sim: SimApi, logic: KitLogic): void {
    this.toastTime += frameDt;
    if (this.toastTime > 1.6 && this.toast.classList.contains('show')) this.toast.classList.remove('show');
    this.armed.classList.toggle('off', !logic.shrapnelArmed);

    const hero = sim.player();
    const h = hero.hero;
    if (!h || skillLevel(hero, SHRAPNEL) === 0) {
      if (this.shown !== 'off') {
        this.shown = 'off';
        this.pips.classList.add('off');
      }
      return;
    }
    const level = skillLevel(hero, SHRAPNEL);
    const charges = h.charges[SHRAPNEL] ?? 0;
    const max = levelValue(SNIPER_SHRAPNEL, 'charges', level);
    const restoreTime = levelValue(SNIPER_SHRAPNEL, 'chargeRestoreTime', level);
    const restoreAt = (h as typeof h & ChargeTimers).chargeRestoreAt?.[SHRAPNEL];
    const frac = restoreAt !== undefined ? Math.max(0, Math.min(1, 1 - (restoreAt - sim.time) / restoreTime)) : 0;
    const key = `${charges}:${Math.round(frac * 40)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.pips.classList.remove('off');
    while (this.pipEls.length < max) {
      const el = document.createElement('span');
      el.className = 'kit-pip';
      this.pips.appendChild(el);
      this.pipEls.push(el);
    }
    this.pipEls.forEach((el, i) => {
      el.classList.toggle('full', i < charges);
      el.style.setProperty('--p', i === charges ? `${(frac * 100).toFixed(0)}%` : '0%');
    });
  }

  dispose(): void {
    this.pips.remove();
    this.armed.remove();
    this.toast.remove();
    this.flash.remove();
  }
}
