// Town Portal channel bar + spinning screen-edge swirl while the TP channels.
import type { PortalChannel } from '../townPortal';

export class ChannelBar {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly vignette: HTMLDivElement;
  private shown = '';

  constructor(root: HTMLElement) {
    this.vignette = document.createElement('div');
    this.vignette.className = 'kit-tpv';
    this.el = document.createElement('div');
    this.el.className = 'kit-ch';
    this.el.innerHTML = '<div class="t"></div><div class="bar"><div></div></div><div class="h">Move, attack or cast to cancel</div>';
    this.title = this.el.querySelector('.t') as HTMLElement;
    this.fill = this.el.querySelector('.bar div') as HTMLElement;
    root.append(this.vignette, this.el);
  }

  update(channel: PortalChannel | null, now: number): void {
    if (!channel) {
      if (this.shown !== 'off') {
        this.shown = 'off';
        this.el.classList.remove('on');
        this.vignette.classList.remove('on');
      }
      return;
    }
    const total = channel.endAt - channel.startAt;
    const p = total > 0 ? Math.min(1, Math.max(0, (now - channel.startAt) / total)) : 1;
    const left = Math.max(0, channel.endAt - now);
    const key = `${channel.seq}:${(p * 200).toFixed(0)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.add('on');
    this.vignette.classList.add('on');
    this.vignette.style.opacity = (0.35 + 0.65 * p).toFixed(2);
    this.title.textContent = `TELEPORTING → ${channel.anchor.name}   ${left.toFixed(1)}s`;
    this.fill.style.width = `${(p * 100).toFixed(1)}%`;
  }

  dispose(): void {
    this.el.remove();
    this.vignette.remove();
  }
}
