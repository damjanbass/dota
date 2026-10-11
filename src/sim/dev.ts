// Dev scene (?scene=sim): 2D top-down view of the live simulation on the loaded map. Units by team, HP bars,
// projectiles, runes, clock and speed controls. Wheel zooms, drag pans.
// URL params: t=<start time, default -3>, speed=<1|4|16>, allies=a,b  enemies=c,d, seed=<n>.
import { SIM_DT } from '../core/config';
import { startLoop } from '../core/loop';
import { PathFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';
import type { Team } from '../core/types';
import { createSim } from './index';
import type { SimWorld } from './types';

declare global {
  interface Window {
    __simDebug?: {
      readonly time: number;
      readonly units: number;
      readonly creeps: number;
      speed: number;
      paused: boolean;
      sim: SimWorld;
    };
  }
}

const TEAM_COLOR: Record<Team, string> = { sentinel: '#4ade80', scourge: '#f87171', neutral: '#facc15' };
const RUNE_LETTER: Record<string, string> = { haste: 'H', doubleDamage: 'D', illusion: 'I', invisibility: 'V', regeneration: 'R', bounty: '$' };

/** Pathing grid → one pixel per cell (trees, cliffs, water, lanes). */
const renderBackground = (map: LoadedMap): HTMLCanvasElement => {
  const p = map.data.pathing;
  const t = map.data.terrain;
  const c = document.createElement('canvas');
  c.width = p.cols;
  c.height = p.rows;
  const g = c.getContext('2d')!;
  const img = g.createImageData(p.cols, p.rows);
  let minL = 255;
  let maxL = 0;
  for (const l of map.cliffLayer) {
    minL = Math.min(minL, l);
    maxL = Math.max(maxL, l);
  }
  for (let cy = 0; cy < p.rows; cy++) {
    for (let cx = 0; cx < p.cols; cx++) {
      const f = map.pathing[cy * p.cols + cx]!;
      const x = p.originX + (cx + 0.5) * p.cellSize;
      const y = p.originY + (cy + 0.5) * p.cellSize;
      const tx = Math.min(t.cols - 1, Math.max(0, Math.round((x - t.originX) / t.cellSize)));
      const ty = Math.min(t.rows - 1, Math.max(0, Math.round((y - t.originY) / t.cellSize)));
      const layer = map.cliffLayer[ty * t.cols + tx]!;
      const shade = maxL > minL ? (layer - minL) / (maxL - minL) : 0.5;
      let r = 52 + shade * 40;
      let gr = 58 + shade * 40;
      let b = 44 + shade * 30;
      if (f & PathFlag.Water) [r, gr, b] = [38, 70, 110];
      if (f & PathFlag.Tree) [r, gr, b] = [22, 48, 26];
      else if (f & PathFlag.Unwalkable) [r, gr, b] = [18, 18, 22];
      // Image rows go top-down; pathing row 0 is the south edge.
      const i = ((p.rows - 1 - cy) * p.cols + cx) * 4;
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
};

const fmtTime = (t: number): string => {
  const s = Math.floor(Math.abs(t));
  return `${t < 0 ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const run: SceneRunner = ({ canvas, ui, map }) => {
  const params = new URLSearchParams(location.search);
  const list = (k: string): string[] => (params.get(k) ?? '').split(',').filter(Boolean);
  const sim = createSim(
    map,
    { seed: Number(params.get('seed') ?? 683), playerHero: 'sniper', allies: list('allies'), enemies: list('enemies'), difficulty: 'medium' },
    { startTime: Number(params.get('t') ?? -3) },
  );
  let speed = Number(params.get('speed') ?? 1) || 1;
  let paused = false;
  const log: string[] = [];
  sim.events.on('announce', (e) => {
    log.unshift(`${fmtTime(sim.time)} ${e.text}`);
    log.length = Math.min(log.length, 8);
  });

  const g = canvas.getContext('2d')!;
  const bg = renderBackground(map);
  const { pathing } = map.data;
  const worldW = pathing.cols * pathing.cellSize;
  const worldH = pathing.rows * pathing.cellSize;

  // View: centre (world) + zoom (px per unit).
  const view = { cx: pathing.originX + worldW / 2, cy: pathing.originY + worldH / 2, zoom: 0.05 };
  const fit = (): void => {
    view.zoom = Math.min(canvas.width / worldW, canvas.height / worldH) * 0.98;
    view.cx = pathing.originX + worldW / 2;
    view.cy = pathing.originY + worldH / 2;
  };
  const resize = (): void => {
    canvas.width = Math.max(320, Math.floor(window.innerWidth));
    canvas.height = Math.max(240, Math.floor(window.innerHeight));
  };
  resize();
  fit();
  window.addEventListener('resize', () => {
    resize();
    fit();
  });
  const sx = (x: number): number => (x - view.cx) * view.zoom + canvas.width / 2;
  const sy = (y: number): number => canvas.height / 2 - (y - view.cy) * view.zoom;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const wx = view.cx + (e.offsetX - canvas.width / 2) / view.zoom;
    const wy = view.cy - (e.offsetY - canvas.height / 2) / view.zoom;
    view.zoom = Math.min(2, Math.max(0.02, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    view.cx = wx - (e.offsetX - canvas.width / 2) / view.zoom;
    view.cy = wy + (e.offsetY - canvas.height / 2) / view.zoom;
  });
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => {
    drag = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    view.cx -= (e.clientX - drag.x) / view.zoom;
    view.cy += (e.clientY - drag.y) / view.zoom;
    drag = { x: e.clientX, y: e.clientY };
  });

  // --- Controls ------------------------------------------------------------
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:8px;right:8px;display:flex;gap:4px;pointer-events:auto;font:12px monospace';
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.testid = `sim-${label}`;
    b.style.cssText = 'padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;cursor:pointer';
    b.addEventListener('click', onClick);
    panel.appendChild(b);
    return b;
  };
  for (const s of [1, 4, 16]) button(`${s}x`, () => {
    speed = s;
    paused = false;
  });
  button('pause', () => {
    paused = !paused;
  });
  button('mid', () => {
    view.cx = 0;
    view.cy = 0;
    view.zoom = 0.25;
  });
  button('fit', fit);
  ui.appendChild(panel);

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#e5e7eb;font:12px monospace;pointer-events:none';
  ui.appendChild(hud);

  window.__simDebug = {
    get time() {
      return sim.time;
    },
    get units() {
      return sim.units().length;
    },
    get creeps() {
      return sim.units().filter((u) => u.alive && u.kind.startsWith('creep')).length;
    },
    get speed() {
      return speed;
    },
    set speed(v: number) {
      speed = v;
    },
    get paused() {
      return paused;
    },
    set paused(v: boolean) {
      paused = v;
    },
    sim,
  };

  const draw = (alpha: number): void => {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#0b0d10';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    g.drawImage(bg, sx(pathing.originX), sy(pathing.originY + worldH), worldW * view.zoom, worldH * view.zoom);

    // Lanes.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (const lane of Object.values(map.data.lanes)) {
      g.beginPath();
      lane.forEach((p, i) => (i === 0 ? g.moveTo(sx(p.x), sy(p.y)) : g.lineTo(sx(p.x), sy(p.y))));
      g.stroke();
    }

    for (const r of sim.runes()) {
      g.fillStyle = '#60a5fa';
      g.font = `${Math.max(10, 14)}px monospace`;
      g.fillText(RUNE_LETTER[r.kind] ?? '?', sx(r.x) - 4, sy(r.y) + 4);
    }

    const units = sim.units();
    for (const u of units) {
      const x = sx(u.prevPosition.x + (u.position.x - u.prevPosition.x) * alpha);
      const y = sy(u.prevPosition.y + (u.position.y - u.prevPosition.y) * alpha);
      if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      const building = u.kind === 'tower' || u.kind.startsWith('barracks') || u.kind === 'ancient' || u.kind === 'fountain' || u.kind === 'building';
      const r = Math.max(building ? 4 : u.kind === 'hero' ? 4 : 2, u.def.collisionRadius * view.zoom);
      g.globalAlpha = u.alive ? 1 : 0.25;
      g.fillStyle = TEAM_COLOR[u.team];
      if (building) {
        g.fillRect(x - r, y - r, r * 2, r * 2);
        if (u.alive && u.kind !== 'building' && u.hp > 0) {
          g.strokeStyle = '#000';
          g.strokeRect(x - r, y - r, r * 2, r * 2);
        }
      } else {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      if (u.kind === 'hero') {
        g.strokeStyle = u.hero?.isPlayer ? '#ffffff' : '#93c5fd';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, r + 3, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1;
      }
      g.globalAlpha = 1;
      if (u.alive && (building || u.kind === 'hero' || view.zoom > 0.1) && u.hp < u.maxHp) {
        const w = Math.max(10, r * 2.4);
        g.fillStyle = '#111';
        g.fillRect(x - w / 2, y - r - 6, w, 3);
        g.fillStyle = u.hp / u.maxHp > 0.5 ? '#22c55e' : u.hp / u.maxHp > 0.25 ? '#eab308' : '#ef4444';
        g.fillRect(x - w / 2, y - r - 6, (w * u.hp) / u.maxHp, 3);
      }
    }

    g.fillStyle = '#fde68a';
    for (const p of sim.projectiles()) {
      const x = sx(p.prevX + (p.x - p.prevX) * alpha);
      const y = sy(p.prevY + (p.y - p.prevY) * alpha);
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    const alive = (team: Team): number => units.filter((u) => u.alive && u.team === team && u.kind.startsWith('creep')).length;
    const pl = sim.player();
    hud.textContent = [
      `time ${fmtTime(sim.time)}  ${sim.isDay ? 'day' : 'night'}  speed ${paused ? 'paused' : `${speed}x`}`,
      `creeps  sentinel ${alive('sentinel')}  scourge ${alive('scourge')}  neutrals ${units.filter((u) => u.alive && u.team === 'neutral').length}`,
      `player  lvl ${pl.hero?.level ?? 1}  gold ${sim.gold(pl.id)}  ${pl.alive ? 'alive' : 'dead'}`,
      sim.winner ? `WINNER: ${sim.winner}` : '',
      ...log,
    ]
      .filter(Boolean)
      .join('\n');
  };

  let ready = false;
  startLoop({
    update: (dt) => {
      if (paused) return;
      for (let i = 0; i < speed; i++) sim.step(SIM_DT);
      void dt;
    },
    render: (alpha) => {
      draw(paused ? 1 : alpha);
      if (!ready) {
        ready = true;
        markSceneReady();
      }
    },
  });
};
