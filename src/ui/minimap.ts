// DotA-style north-up minimap: terrain pre-rendered once from LoadedMap, structures, units (enemies only
// when visible to our team), the player's view cone, and pings on deaths / runes seen.
import { PathFlag, TileFlag } from '../core/map';
import type { LoadedMap } from '../core/map';
import type { UnitState } from '../core/sim';
import type { UnitKind } from '../core/types';
import type { HudContext, HudPart } from './context';
import { createMinimapTransform, minimapToWorld, worldToMinimap, yawToCanvasAngle } from './minimapMath';
import type { MinimapTransform, Point } from './minimapMath';
import { el } from './style';

const TERRAIN_PX = 320;
const COLORS = { sentinel: '#38e038', scourge: '#ff3a2a', neutral: '#f0d040', player: '#ffffff' } as const;
const STRUCTURE_SIZE: Partial<Record<UnitKind, number>> = { tower: 4.2, barracks_melee: 5, barracks_ranged: 4.4, ancient: 8, fountain: 6, building: 3.5 };
/** View cone length on the minimap, world units. */
const CONE_LENGTH = 2200;

const tileRgb = (id: string): [number, number, number] => {
  const s = id.toLowerCase();
  if (/blt|blm|bl[0-9]/.test(s)) return [86, 70, 92];
  if (/snw|ice|snow/.test(s)) return [210, 218, 228];
  if (/rck|rok|rock|cbl|stn|bks|brk/.test(s)) return [118, 114, 104];
  if (/drd/.test(s)) return [104, 84, 58];
  if (/drt|dirt|drk|dgr|mud/.test(s)) return [128, 104, 70];
  if (/vin|lv|leaf/.test(s)) return [62, 104, 46];
  if (/grs|grd|gras|grass/.test(s)) return [80, 122, 56];
  return [96, 110, 72];
};

/** Renders the terrain layer once: ground texture colour, hill shading, water, trees, cliffs. */
export const renderMinimapTerrain = (map: LoadedMap, size: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const t = createMinimapTransform(map.data.bounds, size);
  const { terrain, pathing } = map.data;
  const palette = terrain.groundTextures.map(tileRgb);
  const img = g.createImageData(size, size);
  const w = { x: 0, y: 0 };
  const heightAt = (tx: number, ty: number): number => {
    const cx = Math.max(0, Math.min(terrain.cols - 1, tx));
    const cy = Math.max(0, Math.min(terrain.rows - 1, ty));
    return map.height[cy * terrain.cols + cx]!;
  };
  const b = map.data.bounds;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      minimapToWorld(t, px + 0.5, py + 0.5, w);
      if (w.x < b.minX || w.x > b.maxX || w.y < b.minY || w.y > b.maxY) {
        img.data[o + 3] = 255;
        continue;
      }
      const tx = Math.round((w.x - terrain.originX) / terrain.cellSize);
      const ty = Math.round((w.y - terrain.originY) / terrain.cellSize);
      const ti = Math.max(0, Math.min(terrain.rows - 1, ty)) * terrain.cols + Math.max(0, Math.min(terrain.cols - 1, tx));
      let [r, gr, bl] = palette[map.texture[ti]!] ?? [96, 110, 72];
      // Light from the north-west.
      const slope = (heightAt(tx - 1, ty) - heightAt(tx + 1, ty) + heightAt(tx, ty + 1) - heightAt(tx, ty - 1)) / 256;
      const shade = Math.max(0.55, Math.min(1.35, 1 + slope * 0.9));
      r *= shade;
      gr *= shade;
      bl *= shade;
      const flags = map.tileFlags[ti]!;
      if (flags & TileFlag.Blight) [r, gr, bl] = [r * 0.6 + 40, gr * 0.5 + 20, bl * 0.6 + 50];
      if (!Number.isNaN(map.water[ti]!)) [r, gr, bl] = [34, 74, 120];
      const cx = Math.floor((w.x - pathing.originX) / pathing.cellSize);
      const cy = Math.floor((w.y - pathing.originY) / pathing.cellSize);
      const pf = cx >= 0 && cy >= 0 && cx < pathing.cols && cy < pathing.rows ? map.pathing[cy * pathing.cols + cx]! : PathFlag.Unwalkable;
      if (pf & PathFlag.Tree) [r, gr, bl] = [18, 52, 22];
      else if (pf & PathFlag.Unwalkable && Number.isNaN(map.water[ti]!)) [r, gr, bl] = [r * 0.45, gr * 0.45, bl * 0.45];
      img.data[o] = r;
      img.data[o + 1] = gr;
      img.data[o + 2] = bl;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Darken the edges a bit so units stand out (WC3 minimaps are fairly dark).
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, size, size);
  return canvas;
};

interface Ping {
  x: number;
  y: number;
  color: string;
  at: number;
}

interface RuneMark {
  x: number;
  y: number;
  kind: string;
  seen: boolean;
  until: number;
  id: number;
}

export const createMinimap = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const root = el('div', 'hud-minimap');
  const canvas = el('canvas');
  root.appendChild(canvas);
  parent.appendChild(root);
  const g = canvas.getContext('2d')!;
  const terrain = renderMinimapTerrain(ctx.map, TERRAIN_PX);
  let size = 0;
  let tf: MinimapTransform = createMinimapTransform(ctx.map.data.bounds, 1);
  const p: Point = { x: 0, y: 0 };
  const pings: Ping[] = [];
  const runes: RuneMark[] = [];
  let acc = 1;

  const ping = (x: number, y: number, color: string): void => {
    pings.push({ x, y, color, at: ctx.now() });
    if (pings.length > 24) pings.shift();
  };

  const unsub = [
    ctx.events.on('unit:died', (e) => {
      const u = ctx.sim.get(e.unitId);
      if (!u) return;
      const structure = u.kind === 'tower' || u.kind.startsWith('barracks') || u.kind === 'ancient' || u.kind === 'roshan';
      if (!u.hero && !structure) return;
      ping(u.position.x, u.position.y, u.team === 'sentinel' ? COLORS.sentinel : u.team === 'scourge' ? COLORS.scourge : COLORS.neutral);
    }),
    ctx.events.on('rune:spawned', (e) => {
      for (let i = runes.length - 1; i >= 0; i--) if (Math.hypot(runes[i]!.x - e.x, runes[i]!.y - e.y) < 200) runes.splice(i, 1);
      runes.push({ x: e.x, y: e.y, kind: e.kind, seen: false, until: ctx.now() + 120, id: e.runeId });
    }),
    ctx.events.on('rune:picked', (e) => {
      const i = runes.findIndex((r) => r.id === e.runeId);
      if (i >= 0) runes.splice(i, 1);
    }),
  ];

  /** A rune counts as seen when any allied unit stands within its vision of the spot. */
  const runeSeen = (r: RuneMark): boolean => {
    for (const u of ctx.sim.units()) {
      if (!u.alive || u.team !== ctx.team) continue;
      const dx = u.position.x - r.x;
      const dy = u.position.y - r.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 4000 * 4000) continue;
      const vis = ctx.sim.stats(u.id).vision;
      if (d2 <= vis * vis) return true;
    }
    return false;
  };

  const dot = (u: UnitState, color: string, r: number): void => {
    worldToMinimap(tf, u.position.x, u.position.y, p);
    g.fillStyle = color;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
  };

  const draw = (): void => {
    const sim = ctx.sim;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = canvas.clientWidth || 220;
    const want = Math.round(css * dpr);
    if (want !== size) {
      size = want;
      canvas.width = size;
      canvas.height = size;
      tf = createMinimapTransform(ctx.map.data.bounds, size);
    }
    const k = size / 220;
    g.imageSmoothingEnabled = true;
    g.drawImage(terrain, 0, 0, size, size);
    if (!sim.isDay) {
      g.fillStyle = 'rgba(10, 16, 60, 0.28)';
      g.fillRect(0, 0, size, size);
    }
    const team = ctx.team;
    const me = sim.player();

    // Structures first (always shown: their positions are common knowledge), then creeps, then heroes.
    for (const u of sim.units()) {
      const s = STRUCTURE_SIZE[u.kind];
      if (!s || !u.alive) continue;
      worldToMinimap(tf, u.position.x, u.position.y, p);
      const r = s * k;
      g.fillStyle = '#000';
      g.fillRect(p.x - r - k, p.y - r - k, (r + k) * 2, (r + k) * 2);
      g.fillStyle = COLORS[u.team];
      g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    for (const u of sim.units()) {
      if (!u.alive || u.hero || STRUCTURE_SIZE[u.kind] || u.kind === 'fountain') continue;
      if (u.team !== team && !sim.isVisibleTo(team, u.id)) continue;
      dot(u, u.kind === 'roshan' ? '#ff9a2a' : COLORS[u.team], (u.kind === 'roshan' ? 4 : 1.7) * k);
    }
    for (const u of sim.units()) {
      if (!u.alive || !u.hero || u === me) continue;
      if (u.team !== team && !sim.isVisibleTo(team, u.id)) continue;
      worldToMinimap(tf, u.position.x, u.position.y, p);
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(p.x, p.y, 4.6 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COLORS[u.team];
      g.beginPath();
      g.arc(p.x, p.y, 3.4 * k, 0, Math.PI * 2);
      g.fill();
    }

    // Runes (once seen) and pings.
    const now = ctx.now();
    for (let i = runes.length - 1; i >= 0; i--) {
      const r = runes[i]!;
      if (now > r.until) {
        runes.splice(i, 1);
        continue;
      }
      if (!r.seen && runeSeen(r)) {
        r.seen = true;
        ping(r.x, r.y, '#4af0ff');
      }
      if (!r.seen) continue;
      worldToMinimap(tf, r.x, r.y, p);
      g.fillStyle = r.kind === 'bounty' ? '#ffd040' : '#4af0ff';
      g.strokeStyle = '#000';
      g.lineWidth = k;
      g.beginPath();
      g.moveTo(p.x, p.y - 4 * k);
      g.lineTo(p.x + 4 * k, p.y);
      g.lineTo(p.x, p.y + 4 * k);
      g.lineTo(p.x - 4 * k, p.y);
      g.closePath();
      g.fill();
      g.stroke();
    }
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i]!;
      const age = now - pg.at;
      if (age > 2.4) {
        pings.splice(i, 1);
        continue;
      }
      worldToMinimap(tf, pg.x, pg.y, p);
      const ph = (age % 0.8) / 0.8;
      g.strokeStyle = pg.color;
      g.globalAlpha = 1 - ph;
      g.lineWidth = 2 * k;
      g.beginPath();
      g.arc(p.x, p.y, (3 + ph * 14) * k, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Player: view cone + arrow.
    if (me.alive) {
      worldToMinimap(tf, me.position.x, me.position.y, p);
      const yaw = ctx.player.controller.yaw;
      const fovV = ((ctx.camera.fov ?? 74) * Math.PI) / 180;
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const halfH = Math.atan(Math.tan(fovV / 2) * aspect);
      const len = CONE_LENGTH * tf.scale;
      const a = yawToCanvasAngle(yaw);
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.arc(p.x, p.y, len, a - halfH, a + halfH);
      g.closePath();
      g.fill();
      g.save();
      g.translate(p.x, p.y);
      g.rotate(a);
      g.fillStyle = '#fff';
      g.strokeStyle = '#000';
      g.lineWidth = 1.2 * k;
      g.beginPath();
      g.moveTo(7 * k, 0);
      g.lineTo(-4.5 * k, 4.5 * k);
      g.lineTo(-2 * k, 0);
      g.lineTo(-4.5 * k, -4.5 * k);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  };

  return {
    update(frameDt) {
      // 30 Hz is plenty for a minimap.
      acc += frameDt;
      if (acc < 1 / 30) return;
      acc = 0;
      draw();
    },
    dispose() {
      for (const fn of unsub) fn();
      root.remove();
    },
  };
};
