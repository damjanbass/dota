// Assassinate lock reticle: closing brackets + a progress ring around the crosshair, target name and distance.
import type { SimApi } from '../../../core/sim';
import type { KitLogic } from '../kitLogic';

const R = 44;
const CIRC = 2 * Math.PI * R;

export class AssassinateReticle {
  private readonly el: HTMLDivElement;
  private readonly fg: SVGCircleElement;
  private readonly corners: HTMLElement[];
  private readonly lbl: HTMLElement;
  private readonly tgt: HTMLElement;
  private shownKey = '';

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'kit-rt';
    const ticks = [0, 90, 180, 270]
      .map((a) => {
        const r = (a * Math.PI) / 180;
        return `<line class="tick" x1="${(Math.cos(r) * (R + 6)).toFixed(1)}" y1="${(Math.sin(r) * (R + 6)).toFixed(1)}" x2="${(Math.cos(r) * (R + 12)).toFixed(1)}" y2="${(Math.sin(r) * (R + 12)).toFixed(1)}"/>`;
      })
      .join('');
    this.el.innerHTML =
      `<svg viewBox="-60 -60 120 120"><circle class="bg" r="${R}"/><circle class="fg" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}"/>${ticks}</svg>` +
      '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>' +
      '<div class="lbl">ASSASSINATE</div><div class="tgt"></div><div class="hint">hold on target · R / RMB cancel</div>';
    this.fg = this.el.querySelector('.fg') as SVGCircleElement;
    this.corners = [...this.el.querySelectorAll('i')] as HTMLElement[];
    this.lbl = this.el.querySelector('.lbl') as HTMLElement;
    this.tgt = this.el.querySelector('.tgt') as HTMLElement;
    root.appendChild(this.el);
  }

  update(sim: SimApi, logic: KitLogic): void {
    const aim = logic.aim;
    if (!aim.active) {
      if (this.shownKey !== 'off') {
        this.shownKey = 'off';
        this.el.classList.remove('on', 'lock');
      }
      return;
    }
    const progress = aim.progress(logic.assassinateAimTime());
    const target = aim.targetId !== null ? sim.get(aim.targetId) : undefined;
    const hero = sim.player();
    const dist = target ? Math.hypot(target.position.x - hero.position.x, target.position.y - hero.position.y) : 0;
    const key = `${target?.id ?? -1}:${progress.toFixed(3)}:${dist.toFixed(0)}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.el.classList.add('on');
    this.el.classList.toggle('lock', !!target);
    this.fg.setAttribute('stroke-dashoffset', (CIRC * (1 - progress)).toFixed(2));
    // Brackets close in on the crosshair as the lock completes.
    const d = 70 - 40 * progress;
    const pos: Array<[number, number]> = [
      [-d, -d],
      [d - 14, -d],
      [-d, d - 14],
      [d - 14, d - 14],
    ];
    this.corners.forEach((c, i) => {
      c.style.left = `${pos[i]![0]}px`;
      c.style.top = `${pos[i]![1]}px`;
    });
    this.lbl.textContent = target ? `ASSASSINATE ${Math.round(progress * 100)}%` : 'ACQUIRE TARGET';
    this.tgt.textContent = target ? `${target.def.name} · ${dist.toFixed(0)}` : `range ${logic.assassinateRange().toFixed(0)}`;
  }

  dispose(): void {
    this.el.remove();
  }
}
