// One full-screen 2D canvas for everything anchored in the world: WC3-style overhead health bars,
// floating damage numbers and the hitmarker. No DOM churn; buffers are preallocated.
import { Matrix4, Vector3 } from 'three';
import type { UnitState } from '../core/sim';
import type { UnitKind } from '../core/types';
import type { HudContext, HudPart } from './context';
import { formatDamage } from './format';
import { distanceFade, isDeniable, projectToScreen, selectNearest } from './projection';
import type { ScreenPoint } from './projection';

const MAX_BARS = 200;
const MAX_CANDIDATES = 1024;
/** Unscoped vertical FOV of CS default_fov 90 at 4:3 — apparent distance is measured against it. */
const BASE_VFOV = 73.74;
const NO_BAR: ReadonlySet<UnitKind> = new Set(['fountain']);
const STRUCTURES: ReadonlySet<UnitKind> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient', 'building']);
const DMG_LIFE = 1.0;
const HS_LIFE = 1.3;

interface DamageNumber {
  active: boolean;
  x: number;
  y: number;
  z: number;
  amount: number;
  headshot: boolean;
  at: number;
  drift: number;
}

export const createWorldOverlay = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-world';
  parent.prepend(canvas);
  const g = canvas.getContext('2d')!;
  const vp = new Matrix4();
  const tmp = new Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depth: 0 };
  let w = 0;
  let h = 0;
  let dpr = 1;

  // Candidate buffers (struct-of-arrays, reused every frame).
  const cu: Array<UnitState | null> = new Array<UnitState | null>(MAX_CANDIDATES).fill(null);
  const cx = new Float32Array(MAX_CANDIDATES);
  const cy = new Float32Array(MAX_CANDIDATES);
  const cd = new Float32Array(MAX_CANDIDATES);
  const ca = new Float32Array(MAX_CANDIDATES);
  const order: number[] = [];
  const byDepthDesc = (a: number, b: number): number => cd[b]! - cd[a]!;

  const numbers: DamageNumber[] = Array.from({ length: 48 }, () => ({ active: false, x: 0, y: 0, z: 0, amount: 0, headshot: false, at: 0, drift: 0 }));
  let numberSeq = 0;
  let hitAt = -10;
  let hitHead = false;
  let killAt = -10;

  const playerId = (): number => ctx.sim.player().id;
  const unsub = [
    ctx.events.on('unit:damaged', (e) => {
      if (e.sourceId === null || e.sourceId !== playerId() || e.amount <= 0) return;
      const t = ctx.sim.get(e.targetId);
      if (!t) return;
      // Merge rapid ticks on the same target (Shrapnel) is unnecessary: each tick is ~1 s apart.
      const n = numbers.find((d) => !d.active) ?? numbers[numberSeq % numbers.length]!;
      numberSeq++;
      n.active = true;
      n.x = t.position.x;
      n.y = t.position.y;
      n.z = t.position.z + t.def.height + 10;
      n.amount = e.amount;
      n.headshot = e.headshot;
      n.at = ctx.now();
      n.drift = ((numberSeq * 37) % 21) - 10;
    }),
    ctx.events.on('player:shot', (e) => {
      if (e.result.targetId === null) return;
      hitAt = ctx.now();
      hitHead = e.result.part === 'head';
    }),
    ctx.events.on('unit:died', (e) => {
      if (e.killerId !== null && e.killerId === playerId()) killAt = ctx.now();
    }),
  ];

  const resize = (): void => {
    const nw = window.innerWidth;
    const nh = window.innerHeight;
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (nw === w && nh === h && nd === dpr) return;
    w = nw;
    h = nh;
    dpr = nd;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };

  const drawBar = (x: number, y: number, bw: number, bh: number, frac: number, fill: string, alpha: number): void => {
    const left = Math.round(x - bw / 2);
    const top = Math.round(y - bh);
    g.globalAlpha = alpha;
    g.fillStyle = '#000';
    g.fillRect(left - 1, top - 1, bw + 2, bh + 2);
    g.fillStyle = '#2a0a0a';
    g.fillRect(left, top, bw, bh);
    g.fillStyle = fill;
    g.fillRect(left, top, Math.max(0, Math.round(bw * frac)), bh);
    // WC3 bar sheen.
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(left, top, Math.max(0, Math.round(bw * frac)), Math.max(1, Math.floor(bh / 3)));
  };

  const drawBars = (alpha: number): void => {
    const sim = ctx.sim;
    const me = sim.player();
    const team = ctx.team;
    const fovScale = Math.tan((((ctx.camera.fov ?? BASE_VFOV) * Math.PI) / 180) / 2) / Math.tan(((BASE_VFOV * Math.PI) / 180) / 2);
    let n = 0;
    for (const u of sim.units()) {
      if (n >= MAX_CANDIDATES) break;
      if (!u.alive || u === me || NO_BAR.has(u.kind)) continue;
      if (u.team !== team && !sim.isVisibleTo(team, u.id)) continue;
      const px = u.prevPosition.x + (u.position.x - u.prevPosition.x) * alpha;
      const py = u.prevPosition.y + (u.position.y - u.prevPosition.y) * alpha;
      const pz = u.prevPosition.z + (u.position.z - u.prevPosition.z) * alpha + u.def.height + 14;
      tmp.set(px, pz, -py);
      if (!projectToScreen(vp.elements, tmp.x, tmp.y, tmp.z, w, h, sp, 0.05)) continue;
      const fade = distanceFade(sp.depth * fovScale, STRUCTURES.has(u.kind) ? 3500 : 1700, STRUCTURES.has(u.kind) ? 6000 : 3300);
      if (fade < 0.03) continue;
      cu[n] = u;
      cx[n] = sp.x;
      cy[n] = sp.y;
      cd[n] = sp.depth;
      ca[n] = fade;
      n++;
    }
    const kept = selectNearest(cd, n, MAX_BARS, order);
    order.sort(byDepthDesc);
    const ui = Math.max(0.75, Math.min(1.5, h / 1080));
    const blink = Math.floor(ctx.now() * 5) % 2 === 0;
    g.font = `bold ${Math.round(11 * ui)}px Verdana, Tahoma, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (let k = 0; k < kept; k++) {
      const i = order[k]!;
      const u = cu[i]!;
      const isHero = !!u.hero;
      const structure = STRUCTURES.has(u.kind);
      const bw = Math.round((isHero ? 70 : structure ? 96 : u.kind === 'roshan' ? 90 : 42) * ui);
      const bh = Math.max(3, Math.round((isHero ? 7 : structure ? 7 : 5) * ui));
      const frac = u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0;
      let fill = u.team === team ? '#2ed22e' : u.team === 'neutral' ? '#e8c820' : '#e02a1e';
      const deniable = u.team === team && !isHero && !structure && isDeniable(u.hp, u.maxHp);
      if (deniable && blink) fill = '#f4fff0';
      const x = cx[i]!;
      const y = cy[i]!;
      drawBar(x, y, bw, bh, frac, fill, ca[i]!);
      if (isHero) {
        const mf = u.maxMana > 0 ? Math.max(0, Math.min(1, u.mana / u.maxMana)) : 0;
        const mh = Math.max(2, Math.round(3 * ui));
        const left = Math.round(x - bw / 2);
        g.fillStyle = '#000';
        g.fillRect(left - 1, Math.round(y) + 1, bw + 2, mh + 1);
        g.fillStyle = '#2f7bff';
        g.fillRect(left, Math.round(y) + 1, Math.round(bw * mf), mh);
        g.fillStyle = u.team === team ? '#c8ffc0' : '#ffc8c0';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        const label = `${u.def.name}  ${u.hero!.level}`;
        g.strokeText(label, x, y - bh - 3);
        g.fillText(label, x, y - bh - 3);
      }
      if (deniable) {
        g.fillStyle = blink ? '#ffffff' : '#9cff9c';
        g.fillRect(Math.round(x + bw / 2 + 3), Math.round(y - bh), Math.max(2, Math.round(3 * ui)), bh);
      }
    }
    g.globalAlpha = 1;
    for (let k = 0; k < n; k++) cu[k] = null;
  };

  const drawNumbers = (): void => {
    const now = ctx.now();
    const ui = Math.max(0.75, Math.min(1.5, h / 1080));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const d of numbers) {
      if (!d.active) continue;
      const life = d.headshot ? HS_LIFE : DMG_LIFE;
      const age = now - d.at;
      if (age > life) {
        d.active = false;
        continue;
      }
      tmp.set(d.x, d.z, -d.y);
      if (!projectToScreen(vp.elements, tmp.x, tmp.y, tmp.z, w, h, sp, 0.2)) continue;
      const t = age / life;
      const rise = (d.headshot ? 70 : 52) * ui * (1 - (1 - t) * (1 - t));
      const pop = age < 0.08 ? 1 + (0.08 - age) * 6 : 1;
      const a = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      const x = sp.x + d.drift * ui;
      const y = sp.y - 18 * ui - rise;
      g.globalAlpha = a;
      g.lineWidth = 4 * ui;
      g.strokeStyle = 'rgba(0,0,0,0.9)';
      if (d.headshot) {
        g.font = `900 ${Math.round(30 * ui * pop)}px "Arial Black", Impact, sans-serif`;
        g.fillStyle = '#ff2a1a';
        const text = formatDamage(d.amount);
        g.strokeText(text, x, y);
        g.fillText(text, x, y);
        g.font = `900 ${Math.round(15 * ui)}px "Arial Black", Impact, sans-serif`;
        g.fillStyle = '#ffd040';
        g.strokeText('HEADSHOT', x, y - 24 * ui);
        g.fillText('HEADSHOT', x, y - 24 * ui);
      } else {
        g.font = `900 ${Math.round(19 * ui * pop)}px "Arial Black", Impact, sans-serif`;
        g.fillStyle = '#fff2c8';
        const text = formatDamage(d.amount);
        g.strokeText(text, x, y);
        g.fillText(text, x, y);
      }
    }
    g.globalAlpha = 1;
  };

  const drawHitmarker = (): void => {
    const now = ctx.now();
    const age = now - hitAt;
    if (age > 0.22) return;
    const ui = Math.max(0.75, Math.min(1.5, h / 1080));
    const kill = now - killAt < 0.3;
    const a = 1 - age / 0.22;
    const c = kill || hitHead ? '255,60,40' : '255,255,255';
    const inner = (kill ? 9 : 7) * ui;
    const outer = (kill ? 20 : 15) * ui;
    g.strokeStyle = `rgba(${c},${a.toFixed(3)})`;
    g.lineWidth = Math.max(1.5, 2.2 * ui);
    g.lineCap = 'round';
    g.beginPath();
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      g.moveTo(w / 2 + sx * inner, h / 2 + sy * inner);
      g.lineTo(w / 2 + sx * outer, h / 2 + sy * outer);
    }
    g.stroke();
    g.lineCap = 'butt';
  };

  return {
    update(_frameDt, alpha) {
      resize();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const cam = ctx.camera;
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      drawBars(alpha);
      drawNumbers();
      drawHitmarker();
    },
    dispose() {
      for (const fn of unsub) fn();
      canvas.remove();
    },
  };
};
