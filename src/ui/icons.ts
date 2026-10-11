// Procedural icons (canvas + inline SVG). No Blizzard art: every glyph is drawn from simple shapes.
import type { ItemDef } from '../core/types';

export type AbilityIconKind = 'shrapnel' | 'take_aim' | 'assassinate' | 'tp' | 'headshot';

const TAU = Math.PI * 2;

const makeCanvas = (size: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
};

/** Dark bevelled tile in the WC3 command-card style. */
const tile = (ctx: CanvasRenderingContext2D, s: number, top: string, bottom: string): void => {
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const v = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, s, s);
};

const glow = (ctx: CanvasRenderingContext2D, color: string, blur: number): void => {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
};

const noGlow = (ctx: CanvasRenderingContext2D): void => {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
};

const drawShrapnel = (ctx: CanvasRenderingContext2D, s: number): void => {
  tile(ctx, s, '#5a2a10', '#1c0c06');
  const cx = s * 0.5;
  const cy = s * 0.55;
  // Burst rays.
  glow(ctx, '#ffb347', s * 0.15);
  ctx.fillStyle = '#ffcf5a';
  ctx.beginPath();
  const n = 12;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? s * 0.42 : s * 0.17;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
  ctx.fillStyle = '#fff4c8';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.12, 0, TAU);
  ctx.fill();
  noGlow(ctx);
  // Shell fragments.
  ctx.fillStyle = '#2b2b2b';
  for (const [dx, dy, r] of [
    [-0.3, -0.28, 0.05],
    [0.32, -0.22, 0.045],
    [0.3, 0.3, 0.05],
    [-0.33, 0.25, 0.04],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, TAU);
    ctx.fill();
  }
};

const drawCrosshair = (ctx: CanvasRenderingContext2D, s: number): void => {
  tile(ctx, s, '#123a24', '#06140c');
  const c = s / 2;
  ctx.strokeStyle = '#7dff9a';
  glow(ctx, '#3cff6a', s * 0.12);
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.3, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = s * 0.04;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.14, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of [
    [c, s * 0.08, c, s * 0.34],
    [c, s * 0.66, c, s * 0.92],
    [s * 0.08, c, s * 0.34, c],
    [s * 0.66, c, s * 0.92, c],
  ] as const) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  noGlow(ctx);
  ctx.fillStyle = '#ff4040';
  ctx.beginPath();
  ctx.arc(c, c, s * 0.035, 0, TAU);
  ctx.fill();
};

const drawBullet = (ctx: CanvasRenderingContext2D, s: number): void => {
  tile(ctx, s, '#3a1420', '#12050a');
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-Math.PI / 4);
  // Motion trail.
  const trail = ctx.createLinearGradient(-s * 0.5, 0, -s * 0.05, 0);
  trail.addColorStop(0, 'rgba(255,80,80,0)');
  trail.addColorStop(1, 'rgba(255,140,90,0.85)');
  ctx.fillStyle = trail;
  ctx.fillRect(-s * 0.55, -s * 0.07, s * 0.5, s * 0.14);
  // Casing.
  const brass = ctx.createLinearGradient(0, -s * 0.1, 0, s * 0.1);
  brass.addColorStop(0, '#ffe08a');
  brass.addColorStop(0.5, '#c8902a');
  brass.addColorStop(1, '#6b4612');
  ctx.fillStyle = brass;
  ctx.fillRect(-s * 0.12, -s * 0.1, s * 0.26, s * 0.2);
  // Tip.
  const tip = ctx.createLinearGradient(0, -s * 0.1, 0, s * 0.1);
  tip.addColorStop(0, '#f0d0b0');
  tip.addColorStop(1, '#8a5030');
  ctx.fillStyle = tip;
  ctx.beginPath();
  ctx.moveTo(s * 0.14, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.36, -s * 0.06, s * 0.4, 0);
  ctx.quadraticCurveTo(s * 0.36, s * 0.06, s * 0.14, s * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Target ring.
  ctx.strokeStyle = 'rgba(255,90,90,0.8)';
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.arc(s * 0.74, s * 0.26, s * 0.12, 0, TAU);
  ctx.stroke();
};

const drawScroll = (ctx: CanvasRenderingContext2D, s: number): void => {
  tile(ctx, s, '#1d2c5a', '#080d20');
  const paper = ctx.createLinearGradient(0, s * 0.25, 0, s * 0.75);
  paper.addColorStop(0, '#f6e7bf');
  paper.addColorStop(1, '#c9ad72');
  ctx.fillStyle = paper;
  ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.48);
  ctx.fillStyle = '#8a5a2a';
  for (const y of [0.22, 0.7]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * (y + 0.04), s * 0.3, s * 0.06, 0, 0, TAU);
    ctx.fill();
  }
  // Portal swirl.
  glow(ctx, '#6ab0ff', s * 0.12);
  ctx.strokeStyle = '#3b7bff';
  ctx.lineWidth = s * 0.04;
  ctx.beginPath();
  for (let i = 0; i < 40; i++) {
    const a = i * 0.45;
    const r = s * 0.015 + i * s * 0.0042;
    const x = s * 0.5 + Math.cos(a) * r;
    const y = s * 0.5 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  noGlow(ctx);
};

const drawHeadshot = (ctx: CanvasRenderingContext2D, s: number): void => {
  tile(ctx, s, '#3b3b3b', '#101010');
  // Head silhouette.
  ctx.fillStyle = '#d8cfc0';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.42, s * 0.22, 0, TAU);
  ctx.fill();
  ctx.fillRect(s * 0.36, s * 0.55, s * 0.28, s * 0.14);
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(s * 0.42, s * 0.44, s * 0.05, 0, TAU);
  ctx.arc(s * 0.58, s * 0.44, s * 0.05, 0, TAU);
  ctx.fill();
  ctx.fillRect(s * 0.4, s * 0.6, s * 0.03, s * 0.08);
  ctx.fillRect(s * 0.485, s * 0.6, s * 0.03, s * 0.08);
  ctx.fillRect(s * 0.57, s * 0.6, s * 0.03, s * 0.08);
  // Bullet hole + spray.
  glow(ctx, '#ff2020', s * 0.1);
  ctx.fillStyle = '#e01818';
  ctx.beginPath();
  ctx.arc(s * 0.62, s * 0.3, s * 0.06, 0, TAU);
  ctx.fill();
  for (const [dx, dy, r] of [
    [0.75, 0.2, 0.025],
    [0.8, 0.3, 0.02],
    [0.72, 0.14, 0.018],
  ] as const) {
    ctx.beginPath();
    ctx.arc(s * dx, s * dy, s * r, 0, TAU);
    ctx.fill();
  }
  noGlow(ctx);
};

const ABILITY_DRAW: Record<AbilityIconKind, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  shrapnel: drawShrapnel,
  take_aim: drawCrosshair,
  assassinate: drawBullet,
  tp: drawScroll,
  headshot: drawHeadshot,
};

const abilityCache = new Map<string, HTMLCanvasElement>();

/** Cached offscreen canvas with the ability icon at `size` px. */
export const abilityIcon = (kind: AbilityIconKind, size: number): HTMLCanvasElement => {
  const key = `${kind}:${size}`;
  let c = abilityCache.get(key);
  if (!c) {
    const [canvas, ctx] = makeCanvas(size);
    ABILITY_DRAW[kind](ctx, size);
    abilityCache.set(key, canvas);
    c = canvas;
  }
  return c;
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type Motif = 'scroll' | 'potion' | 'leaf' | 'boot' | 'glove' | 'belt' | 'robe' | 'sword' | 'hammer' | 'axe' | 'staff' | 'spear' | 'shield' | 'mask' | 'helm' | 'gem' | 'bow' | 'wings' | 'amulet' | 'orb';

const MOTIFS: Array<[RegExp, Motif]> = [
  [/recipe|tpscroll/, 'scroll'],
  [/salve|clarity/, 'potion'],
  [/tango/, 'leaf'],
  [/boots|treads/, 'boot'],
  [/gloves/, 'glove'],
  [/belt/, 'belt'],
  [/robe/, 'robe'],
  [/hammer|maelstrom|mjollnir/, 'hammer'],
  [/axe/, 'axe'],
  [/staff|monkey/, 'staff'],
  [/javelin/, 'spear'],
  [/black_king/, 'shield'],
  [/mask/, 'mask'],
  [/helm|satanic/, 'helm'],
  [/hyperstone|talisman/, 'gem'],
  [/eaglehorn|buriza/, 'bow'],
  [/butterfly/, 'wings'],
  [/amulet|lothar/, 'amulet'],
  [/blade|sword|claymore|edge|crystalys|reaver/, 'sword'],
];

const motifOf = (id: string): Motif => MOTIFS.find(([re]) => re.test(id))?.[1] ?? 'orb';

/** Background hue by the item's main stat. */
const itemHue = (item: ItemDef): [string, string] => {
  const s = item.stats;
  if (/recipe/.test(item.id)) return ['#6a5a30', '#241c08'];
  if (item.id === 'tpscroll') return ['#1d2c5a', '#080d20'];
  if (item.id === 'clarity_potion') return ['#1d3a6a', '#081428'];
  if (item.id === 'healing_salve' || item.id === 'tango') return ['#2f5a1d', '#0c1c06'];
  if (item.shop === 'secret') return ['#4a2060', '#14061c'];
  if (s.str) return ['#6a2020', '#200606'];
  if (s.agi) return ['#2a5a24', '#0a1c08'];
  if (s.int) return ['#20386a', '#060e20'];
  if (s.damage) return ['#6a4a1a', '#201406'];
  if (s.attackSpeed) return ['#5a5a1a', '#1c1c06'];
  if (s.armor || s.hpRegen) return ['#4a4a52', '#141418'];
  return ['#3a3a44', '#101014'];
};

const METAL = '#d9dde4';
const GOLD = '#f0c050';

const drawMotif = (ctx: CanvasRenderingContext2D, m: Motif, s: number, item: ItemDef): void => {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const L = (w: number): void => {
    ctx.lineWidth = s * w;
  };
  switch (m) {
    case 'scroll':
      drawScroll(ctx, s);
      if (/recipe/.test(item.id)) {
        ctx.fillStyle = 'rgba(60,30,0,0.85)';
        ctx.font = `bold ${Math.round(s * 0.2)}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('R', s * 0.5, s * 0.5);
      }
      return;
    case 'potion': {
      const col = item.id === 'clarity_potion' ? '#4aa8ff' : '#ff5050';
      ctx.fillStyle = col;
      glow(ctx, col, s * 0.12);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.6, s * 0.22, 0, TAU);
      ctx.fill();
      noGlow(ctx);
      ctx.fillStyle = '#cfd6dc';
      ctx.fillRect(s * 0.42, s * 0.22, s * 0.16, s * 0.2);
      ctx.fillStyle = '#7a4a20';
      ctx.fillRect(s * 0.4, s * 0.16, s * 0.2, s * 0.08);
      return;
    }
    case 'leaf':
      ctx.fillStyle = '#7ad04a';
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.5, s * 0.16, s * 0.32, Math.PI / 5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2a5a14';
      L(0.04);
      ctx.beginPath();
      ctx.moveTo(s * 0.34, s * 0.75);
      ctx.lineTo(s * 0.64, s * 0.28);
      ctx.stroke();
      return;
    case 'boot':
      ctx.fillStyle = /treads/.test(item.id) ? '#c86a2a' : /elven/.test(item.id) ? '#6ad04a' : '#a07850';
      ctx.beginPath();
      ctx.moveTo(s * 0.34, s * 0.18);
      ctx.lineTo(s * 0.56, s * 0.18);
      ctx.lineTo(s * 0.56, s * 0.58);
      ctx.lineTo(s * 0.8, s * 0.66);
      ctx.lineTo(s * 0.8, s * 0.8);
      ctx.lineTo(s * 0.3, s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(s * 0.3, s * 0.74, s * 0.5, s * 0.06);
      if (/speed|treads/.test(item.id)) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(s * 0.34, s * 0.34);
        ctx.lineTo(s * 0.16, s * 0.28);
        ctx.lineTo(s * 0.34, s * 0.44);
        ctx.fill();
      }
      return;
    case 'glove':
      ctx.fillStyle = '#e0b060';
      ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.38);
      for (let i = 0; i < 4; i++) ctx.fillRect(s * (0.3 + i * 0.1), s * 0.2, s * 0.08, s * 0.24);
      ctx.fillRect(s * 0.18, s * 0.42, s * 0.14, s * 0.08);
      return;
    case 'belt':
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(s * 0.12, s * 0.4, s * 0.76, s * 0.2);
      ctx.strokeStyle = GOLD;
      L(0.05);
      ctx.strokeRect(s * 0.4, s * 0.36, s * 0.2, s * 0.28);
      return;
    case 'robe':
      ctx.fillStyle = '#4a7ae0';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.16);
      ctx.lineTo(s * 0.78, s * 0.84);
      ctx.lineTo(s * 0.22, s * 0.84);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.fillRect(s * 0.46, s * 0.3, s * 0.08, s * 0.5);
      return;
    case 'sword': {
      const big = item.cost >= 2000;
      ctx.strokeStyle = /crystalys|buriza/.test(item.id) ? '#ff8080' : /demon/.test(item.id) ? '#b070ff' : METAL;
      glow(ctx, 'rgba(255,255,255,0.4)', s * 0.06);
      L(big ? 0.1 : 0.08);
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.74);
      ctx.lineTo(s * 0.8, s * 0.2);
      ctx.stroke();
      noGlow(ctx);
      ctx.strokeStyle = GOLD;
      L(0.07);
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.56);
      ctx.lineTo(s * 0.44, s * 0.8);
      ctx.moveTo(s * 0.26, s * 0.74);
      ctx.lineTo(s * 0.14, s * 0.86);
      ctx.stroke();
      return;
    }
    case 'hammer':
      ctx.strokeStyle = '#8a6a40';
      L(0.07);
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.82);
      ctx.lineTo(s * 0.6, s * 0.32);
      ctx.stroke();
      ctx.save();
      ctx.translate(s * 0.62, s * 0.3);
      ctx.rotate(Math.PI / 6);
      ctx.fillStyle = /maelstrom|mjollnir/.test(item.id) ? '#7ac8ff' : METAL;
      ctx.fillRect(-s * 0.2, -s * 0.1, s * 0.4, s * 0.2);
      ctx.restore();
      if (/maelstrom|mjollnir/.test(item.id)) {
        ctx.strokeStyle = '#d0f0ff';
        glow(ctx, '#7ac8ff', s * 0.1);
        L(0.035);
        ctx.beginPath();
        ctx.moveTo(s * 0.18, s * 0.2);
        ctx.lineTo(s * 0.3, s * 0.32);
        ctx.lineTo(s * 0.22, s * 0.38);
        ctx.lineTo(s * 0.34, s * 0.5);
        ctx.stroke();
        noGlow(ctx);
      }
      return;
    case 'axe':
      ctx.strokeStyle = '#8a6a40';
      L(0.07);
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.84);
      ctx.lineTo(s * 0.62, s * 0.2);
      ctx.stroke();
      ctx.fillStyle = METAL;
      ctx.beginPath();
      ctx.moveTo(s * 0.56, s * 0.28);
      ctx.quadraticCurveTo(s * 0.92, s * 0.24, s * 0.82, s * 0.6);
      ctx.lineTo(s * 0.5, s * 0.42);
      ctx.closePath();
      ctx.fill();
      return;
    case 'staff':
      ctx.strokeStyle = /monkey/.test(item.id) ? GOLD : '#a07040';
      L(0.07);
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.82);
      ctx.lineTo(s * 0.8, s * 0.18);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      for (const t of [0.15, 0.85]) {
        ctx.beginPath();
        ctx.arc(s * (0.2 + 0.6 * t), s * (0.82 - 0.64 * t), s * 0.06, 0, TAU);
        ctx.fill();
      }
      return;
    case 'spear':
      ctx.strokeStyle = '#a07040';
      L(0.05);
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.84);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.stroke();
      ctx.fillStyle = METAL;
      ctx.beginPath();
      ctx.moveTo(s * 0.84, s * 0.14);
      ctx.lineTo(s * 0.62, s * 0.28);
      ctx.lineTo(s * 0.72, s * 0.38);
      ctx.closePath();
      ctx.fill();
      return;
    case 'shield':
      ctx.fillStyle = '#202024';
      ctx.strokeStyle = GOLD;
      L(0.05);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.14);
      ctx.lineTo(s * 0.8, s * 0.26);
      ctx.lineTo(s * 0.74, s * 0.66);
      ctx.lineTo(s * 0.5, s * 0.86);
      ctx.lineTo(s * 0.26, s * 0.66);
      ctx.lineTo(s * 0.2, s * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    case 'mask':
      ctx.fillStyle = '#d8d0c0';
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.48, s * 0.26, s * 0.32, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#300';
      ctx.beginPath();
      ctx.ellipse(s * 0.4, s * 0.42, s * 0.07, s * 0.05, 0, 0, TAU);
      ctx.ellipse(s * 0.6, s * 0.42, s * 0.07, s * 0.05, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#c02020';
      ctx.fillRect(s * 0.4, s * 0.62, s * 0.2, s * 0.05);
      return;
    case 'helm':
      ctx.fillStyle = /satanic/.test(item.id) ? '#b02020' : '#8a8f98';
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.52, s * 0.28, Math.PI, 0);
      ctx.lineTo(s * 0.78, s * 0.76);
      ctx.lineTo(s * 0.22, s * 0.76);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.07);
      ctx.fillRect(s * 0.47, s * 0.5, s * 0.06, s * 0.22);
      if (/dominator|satanic/.test(item.id)) {
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(s * 0.5, s * 0.1);
        ctx.lineTo(s * 0.56, s * 0.26);
        ctx.lineTo(s * 0.44, s * 0.26);
        ctx.fill();
      }
      return;
    case 'gem': {
      const col = /hyperstone/.test(item.id) ? '#ffb030' : '#60ffd0';
      ctx.fillStyle = col;
      glow(ctx, col, s * 0.15);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.16);
      ctx.lineTo(s * 0.78, s * 0.44);
      ctx.lineTo(s * 0.5, s * 0.84);
      ctx.lineTo(s * 0.22, s * 0.44);
      ctx.closePath();
      ctx.fill();
      noGlow(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.16);
      ctx.lineTo(s * 0.62, s * 0.44);
      ctx.lineTo(s * 0.38, s * 0.44);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'bow':
      ctx.strokeStyle = /buriza/.test(item.id) ? '#ff6060' : '#c8a060';
      L(0.07);
      ctx.beginPath();
      ctx.arc(s * 0.3, s * 0.5, s * 0.36, -Math.PI / 2.6, Math.PI / 2.6);
      ctx.stroke();
      ctx.strokeStyle = '#eee';
      L(0.02);
      ctx.beginPath();
      ctx.moveTo(s * 0.46, s * 0.17);
      ctx.lineTo(s * 0.46, s * 0.83);
      ctx.stroke();
      return;
    case 'wings':
      ctx.fillStyle = '#ffd040';
      glow(ctx, '#ffd040', s * 0.1);
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * (0.5 + dir * 0.18), s * 0.4, s * 0.16, s * 0.22, dir * 0.5, 0, TAU);
        ctx.ellipse(s * (0.5 + dir * 0.14), s * 0.68, s * 0.1, s * 0.13, -dir * 0.4, 0, TAU);
        ctx.fill();
      }
      noGlow(ctx);
      ctx.fillStyle = '#222';
      ctx.fillRect(s * 0.48, s * 0.28, s * 0.04, s * 0.5);
      return;
    case 'amulet': {
      ctx.strokeStyle = GOLD;
      L(0.035);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.3, s * 0.24, Math.PI * 0.1, Math.PI * 0.9, true);
      ctx.stroke();
      const col = /lothar/.test(item.id) ? '#b070ff' : '#7a7aff';
      ctx.fillStyle = col;
      glow(ctx, col, s * 0.12);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.64, s * 0.16, 0, TAU);
      ctx.fill();
      noGlow(ctx);
      return;
    }
    case 'orb':
      ctx.fillStyle = '#b0b8ff';
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.24, 0, TAU);
      ctx.fill();
      return;
  }
};

const itemCache = new Map<string, string>();

/** Cached data URL of a procedural item icon. */
export const itemIconUrl = (item: ItemDef, size = 64): string => {
  const key = `${item.id}:${size}`;
  let url = itemCache.get(key);
  if (url) return url;
  const [canvas, ctx] = makeCanvas(size);
  const motif = motifOf(item.id);
  if (motif !== 'scroll') {
    const [a, b] = itemHue(item);
    tile(ctx, size, a, b);
  }
  drawMotif(ctx, motif, size, item);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  url = canvas.toDataURL();
  itemCache.set(key, url);
  return url;
};

// ---------------------------------------------------------------------------
// Small inline SVG glyphs (kill feed, HUD labels)
// ---------------------------------------------------------------------------

const svg = (body: string, w = 32, h = 20): string =>
  `<svg class="hud-glyph" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;

export const GLYPHS = {
  /** CS-style headshot: a head with a bullet hole. */
  headshot: svg(
    '<circle cx="12" cy="9" r="6.5" fill="#f2f2f2"/><rect x="8.5" y="13" width="7" height="4" fill="#f2f2f2"/>' +
      '<circle cx="9.6" cy="9" r="1.5" fill="#222"/><circle cx="14.4" cy="9" r="1.5" fill="#222"/>' +
      '<circle cx="17.5" cy="5" r="2.4" fill="#ff2a2a"/><path d="M19 4 L28 1 M19.5 6 L29 6" stroke="#ff2a2a" stroke-width="1.4"/>',
  ),
  rifle: svg(
    '<path d="M1 11 h7 l2 -2 h17 v2 h4 v1.5 h-4 v1 h-10 l-3 4 h-3 l2 -4 h-6 l-6 3 z" fill="#f2f2f2"/><rect x="12" y="6.3" width="9" height="2.2" rx="1" fill="#f2f2f2"/>',
  ),
  shrapnel: svg(
    '<g fill="#ffb347"><path d="M16 1 L18 8 L25 4 L21 10 L30 11 L21 13 L26 19 L18 15 L16 21 L14 15 L6 19 L11 13 L2 11 L11 10 L7 4 L14 8 Z"/></g><circle cx="16" cy="11" r="2.5" fill="#fff4c8"/>',
  ),
  assassinate: svg('<path d="M2 10 h18 l8 0 q3 1 0 2 h-26 z" fill="#ffd27a"/><path d="M2 9 h-0 v4 h4 v-4z" fill="#c8902a"/><path d="M0 11 h-0" stroke="#f55"/>'),
  melee: svg('<path d="M4 18 L22 3 L26 2 L25 6 L10 22 Z" fill="#e8e8e8"/><path d="M3 14 L9 20" stroke="#d0a040" stroke-width="2.5"/>'),
  ranged: svg('<path d="M2 11 h22" stroke="#e8e8e8" stroke-width="2"/><path d="M24 7 L31 11 L24 15 Z" fill="#e8e8e8"/><path d="M2 8 L6 11 L2 14" stroke="#e8e8e8" stroke-width="1.5" fill="none"/>'),
  tower: svg('<path d="M10 19 h12 l-2 -12 h2 v-5 h-3 v2 h-2 v-2 h-2 v2 h-2 v-2 h-3 v5 h2 z" fill="#e8e8e8"/>'),
  spell: svg('<path d="M16 1 L19 8 L27 8 L21 13 L23 21 L16 16 L9 21 L11 13 L5 8 L13 8 Z" fill="#9ad0ff"/>'),
  deny: svg('<text x="16" y="17" text-anchor="middle" font-size="18" font-weight="900" font-family="Arial Black, Arial" fill="#ffd040">!</text>'),
  skull: svg(
    '<circle cx="16" cy="9" r="7" fill="#e8e8e8"/><rect x="12" y="13" width="8" height="5" fill="#e8e8e8"/><circle cx="13.3" cy="9" r="1.8" fill="#222"/><circle cx="18.7" cy="9" r="1.8" fill="#222"/>',
  ),
  firstblood: svg('<path d="M16 2 C 20 9 24 12 24 15 a 8 6 0 0 1 -16 0 C 8 12 12 9 16 2 Z" fill="#e01818"/>'),
  sun: svg('<circle cx="12" cy="12" r="5" fill="#ffd34a"/><g stroke="#ffd34a" stroke-width="2"><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3"/></g>', 24, 24),
  moon: svg('<path d="M15 3 a9 9 0 1 0 6 15 a7 7 0 1 1 -6 -15 z" fill="#bcd0ff"/>', 24, 24),
  coin: svg('<circle cx="12" cy="12" r="10" fill="#f0c040" stroke="#8a6010" stroke-width="2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#a87418" stroke-width="1.6"/>', 24, 24),
  cross: svg('<path d="M8 1 h8 v7 h7 v8 h-7 v7 h-8 v-7 h-7 v-8 h7 z" fill="currentColor"/>', 24, 24),
  mana: svg('<path d="M12 1 L21 12 L12 23 L3 12 Z" fill="currentColor"/>', 24, 24),
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** Two-letter portrait initials for a hero name. */
export const heroInitials = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const HERO_COLORS: Record<string, string> = {
  sniper: '#c8a050',
  pudge: '#8a5a5a',
  lion: '#b04020',
  viper: '#4a9a3a',
  shadow_fiend: '#7a2a2a',
  lich: '#4a7ab0',
};

/** Portrait tint for a hero (stable per id). */
export const heroColor = (id: string): string => {
  const known = HERO_COLORS[id];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 40%)`;
};
