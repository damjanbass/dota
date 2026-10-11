// Town Portal tactical map: a full-screen canvas drawn from LoadedMap (terrain, water, trees, lanes) with the team's
// living structures. Hover shows the destination and landing spot, click picks it. Esc / F / RMB closes.
import { PathFlag, TileFlag } from '../../../core/map';
import type { LoadedMap } from '../../../core/map';
import type { SimApi } from '../../../core/sim';
import type { Vec2 } from '../../../core/types';
import { ITEM_TPSCROLL_ABILITY, levelValue } from '../../../data';
import type { KitLogic } from '../kitLogic';
import { nearestAnchor, portalAnchors, resolvePortal } from '../townPortal';
import type { PortalAnchor } from '../townPortal';

/** Pick radius around a structure icon, in CSS pixels. */
const PICK_PX = 40;

const backgrounds = new WeakMap<LoadedMap, HTMLCanvasElement>();

/** One pixel per pathing cell: ground shaded by height, water, trees, cliffs / unwalkable. Cached per map. */
const mapBackground = (map: LoadedMap): HTMLCanvasElement => {
  const cached = backgrounds.get(map);
  if (cached) return cached;
  const p = map.data.pathing;
  const t = map.data.terrain;
  const canvas = document.createElement('canvas');
  canvas.width = p.cols;
  canvas.height = p.rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(p.cols, p.rows);
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of map.height) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const span = Math.max(1, hi - lo);
  for (let cy = 0; cy < p.rows; cy++) {
    const wy = p.originY + (cy + 0.5) * p.cellSize;
    const ty = Math.min(t.rows - 1, Math.max(0, Math.round((wy - t.originY) / t.cellSize)));
    for (let cx = 0; cx < p.cols; cx++) {
      const wx = p.originX + (cx + 0.5) * p.cellSize;
      const tx = Math.min(t.cols - 1, Math.max(0, Math.round((wx - t.originX) / t.cellSize)));
      const ti = ty * t.cols + tx;
      const flags = map.pathing[cy * p.cols + cx]!;
      const shade = 0.55 + 0.6 * ((map.height[ti]! - lo) / span);
      let r = 74;
      let g = 104;
      let b = 58;
      if (map.tileFlags[ti]! & TileFlag.Blight) {
        r = 82;
        g = 70;
        b = 88;
      }
      if (flags & PathFlag.Water || !Number.isNaN(map.water[ti]!)) {
        r = 38;
        g = 78;
        b = 120;
      } else if (flags & PathFlag.Tree) {
        r = 30;
        g = 62;
        b = 34;
      } else if (flags & PathFlag.Unwalkable) {
        r = 52;
        g = 50;
        b = 46;
      }
      const o = ((p.rows - 1 - cy) * p.cols + cx) * 4; // row 0 = south → bottom of the image
      img.data[o] = Math.min(255, r * shade);
      img.data[o + 1] = Math.min(255, g * shade);
      img.data[o + 2] = Math.min(255, b * shade);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  backgrounds.set(map, canvas);
  return canvas;
};

interface Layout {
  scale: number;
  ox: number;
  oy: number;
}

export class TpMapOverlay {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private layout: Layout = { scale: 1, ox: 0, oy: 0 };
  private mouse: Vec2 | null = null;
  private anchors: PortalAnchor[] = [];
  private open = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    private readonly sim: SimApi,
    private readonly logic: KitLogic,
    private readonly onPicked: (point: Vec2) => void,
    private readonly onClosed: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'kit-map';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    root.appendChild(this.el);

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      this.el.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => this.el.removeEventListener(type, fn as EventListener));
    };
    on('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    on('mouseleave', () => {
      this.mouse = null;
    });
    on('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        this.onClosed();
        return;
      }
      if (e.button !== 0) return;
      const pick = this.pick(e.clientX, e.clientY);
      if (pick) this.onPicked(pick.point);
    });
    on('contextmenu', (e) => e.preventDefault());
    const onKey = (e: KeyboardEvent): void => {
      if (!this.open) return;
      // While the pointer is locked the game's own 'townPortal' binding toggles the map; Escape always closes.
      if (e.code === 'Escape' || (e.code === 'KeyF' && !this.logic.player.input.active)) {
        e.preventDefault();
        this.onClosed();
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanup.push(() => window.removeEventListener('keydown', onKey));
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.el.classList.toggle('on', open);
    if (open) {
      this.mouse = null;
      this.resize();
    }
  }

  /** CSS-pixel position of a world point on the open map (test hook). */
  screenPoint(x: number, y: number): Vec2 {
    const l = this.layout;
    const b = this.sim.map.data.bounds;
    return { x: l.ox + (x - b.minX) * l.scale, y: l.oy + (b.maxY - y) * l.scale };
  }

  worldPoint(sx: number, sy: number): Vec2 {
    const l = this.layout;
    const b = this.sim.map.data.bounds;
    return { x: b.minX + (sx - l.ox) / l.scale, y: b.maxY - (sy - l.oy) / l.scale };
  }

  /** Structure nearest to a screen point within the pick radius. */
  pick(sx: number, sy: number): { anchor: PortalAnchor; point: Vec2 } | null {
    const point = this.worldPoint(sx, sy);
    const a = nearestAnchor(this.anchors, point.x, point.y);
    if (!a) return null;
    const s = this.screenPoint(a.x, a.y);
    return Math.hypot(s.x - sx, s.y - sy) <= PICK_PX ? { anchor: a, point } : null;
  }

  render(): void {
    if (!this.open) return;
    const sim = this.sim;
    const hero = sim.player();
    this.anchors = portalAnchors(sim, hero.team);
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const map = sim.map;
    const b = map.data.bounds;
    const p = map.data.pathing;
    const l = this.layout;
    // Background image covers the whole pathing grid; the view is fitted to the playable bounds.
    const bg = mapBackground(map);
    const gx0 = l.ox + (p.originX - b.minX) * l.scale;
    const gy0 = l.oy + (b.maxY - (p.originY + p.rows * p.cellSize)) * l.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(l.ox, l.oy, (b.maxX - b.minX) * l.scale, (b.maxY - b.minY) * l.scale);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bg, gx0, gy0, p.cols * p.cellSize * l.scale, p.rows * p.cellSize * l.scale);
    ctx.restore();
    ctx.strokeStyle = 'rgba(210,190,120,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(l.ox, l.oy, (b.maxX - b.minX) * l.scale, (b.maxY - b.minY) * l.scale);

    // Lanes.
    ctx.strokeStyle = 'rgba(235,205,130,0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    for (const lane of Object.values(map.data.lanes)) {
      if (lane.length < 2) continue;
      ctx.beginPath();
      lane.forEach((pt, i) => {
        const s = this.screenPoint(pt.x, pt.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Hover → destination + landing preview.
    const hover = this.mouse ? this.pick(this.mouse.x, this.mouse.y) : null;
    const landingMax = levelValue(ITEM_TPSCROLL_ABILITY, 'landingMaxDistance', 1);
    for (const a of this.anchors) this.drawAnchor(a, hover?.anchor === a);
    if (hover) {
      const res = resolvePortal(sim, hero.team, hover.point, landingMax);
      if (res) {
        const s = this.screenPoint(res.landing.x, res.landing.y);
        ctx.fillStyle = '#9fe4ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
        const a = this.screenPoint(hover.anchor.x, hover.anchor.y);
        ctx.font = 'bold 13px Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(hover.anchor.name, a.x, a.y - 18);
        ctx.shadowBlur = 0;
      }
    }

    // The player.
    const me = this.screenPoint(hero.position.x, hero.position.y);
    const yaw = this.logic.player.controller.yaw;
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffe14a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fe4ff';
    ctx.font = 'bold 18px Verdana, sans-serif';
    ctx.fillText('TOWN PORTAL', w / 2, 30);
    ctx.font = '12px Verdana, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(hover ? `Click to teleport to ${hover.anchor.name}` : 'Click near an allied structure · Esc / F / RMB to cancel', w / 2, 50);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.el.remove();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.el.clientWidth || window.innerWidth);
    const h = Math.max(1, this.el.clientHeight || window.innerHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const b = this.sim.map.data.bounds;
    const top = 64;
    const pad = 20;
    const scale = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - top - pad) / (b.maxY - b.minY));
    this.layout = { scale, ox: (w - (b.maxX - b.minX) * scale) / 2, oy: top + (h - top - pad - (b.maxY - b.minY) * scale) / 2 };
  }

  private drawAnchor(a: PortalAnchor, hot: boolean): void {
    const ctx = this.ctx;
    const s = this.screenPoint(a.x, a.y);
    const size = a.kind === 'ancient' ? 9 : a.kind === 'fountain' ? 7 : a.kind.startsWith('barracks') ? 6 : 5;
    if (hot) {
      ctx.strokeStyle = '#9fe4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = hot ? '#c8ffd6' : '#4fe07a';
    ctx.strokeStyle = '#06200d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (a.kind === 'fountain') ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
    else if (a.kind === 'ancient') {
      ctx.moveTo(s.x, s.y - size);
      ctx.lineTo(s.x + size, s.y);
      ctx.lineTo(s.x, s.y + size);
      ctx.lineTo(s.x - size, s.y);
      ctx.closePath();
    } else ctx.rect(s.x - size, s.y - size, size * 2, size * 2);
    ctx.fill();
    ctx.stroke();
  }
}
