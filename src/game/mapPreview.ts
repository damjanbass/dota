// Top-down 2D debug view of the loaded map (real or mock). Verifies the MapData contract visually.
import { PathFlag, TileFlag } from '../core/map';
import type { MapEntityKind } from '../core/map';
import { markSceneReady } from '../core/scene';
import type { SceneRunner } from '../core/scene';

const ENTITY_STYLE: Partial<Record<MapEntityKind, { color: string; size: number }>> = {
  tower: { color: '#ffd84a', size: 6 },
  barracks_melee: { color: '#ff8a3d', size: 7 },
  barracks_ranged: { color: '#ff5d8f', size: 7 },
  ancient: { color: '#ffffff', size: 11 },
  fountain: { color: '#5ff', size: 9 },
  shop: { color: '#b48cff', size: 5 },
  secret_shop: { color: '#e040fb', size: 6 },
  side_shop: { color: '#9c27b0', size: 6 },
  neutral_camp: { color: '#ffb300', size: 5 },
  rune_spot: { color: '#00e676', size: 5 },
  roshan: { color: '#ff1744', size: 10 },
  creep_spawn: { color: '#aaa', size: 3 },
};

export const run: SceneRunner = ({ canvas, ui, map }) => {
  const size = Math.min(window.innerWidth, window.innerHeight);
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  const { bounds, terrain, pathing } = map.data;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const sx = (x: number): number => ((x - bounds.minX) / w) * size;
  const sy = (y: number): number => size - ((y - bounds.minY) / h) * size;

  // Terrain: height shading + blight tint + water. Heights are absolute (real map ground ≈ 1024).
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const z of map.height) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const zSpan = Math.max(1, zMax - zMin);
  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = bounds.minX + (px / size) * w;
      const y = bounds.minY + ((size - py) / size) * h;
      const tx = Math.round((x - terrain.originX) / terrain.cellSize);
      const ty = Math.round((y - terrain.originY) / terrain.cellSize);
      const ti = Math.max(0, Math.min(terrain.rows - 1, ty)) * terrain.cols + Math.max(0, Math.min(terrain.cols - 1, tx));
      const z = map.height[ti]!;
      const flags = map.tileFlags[ti]!;
      const shade = 0.4 + 0.6 * ((z - zMin) / zSpan);
      let r = 60 * shade;
      let g = 120 * shade;
      let b = 50 * shade;
      if (flags & TileFlag.Blight) [r, g, b] = [80 * shade, 60 * shade, 90 * shade];
      if (!Number.isNaN(map.water[ti]!)) [r, g, b] = [40, 90, 150];
      const cx = Math.floor((x - pathing.originX) / pathing.cellSize);
      const cy = Math.floor((y - pathing.originY) / pathing.cellSize);
      const pf = map.pathing[cy * pathing.cols + cx] ?? PathFlag.Unwalkable;
      if (pf & PathFlag.Tree) [r, g, b] = [20, 60, 25];
      else if (pf & PathFlag.Unwalkable) [r, g, b] = [r * 0.4, g * 0.4, b * 0.4];
      const o = (py * size + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Lanes.
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,230,150,0.6)';
  for (const lane of Object.values(map.data.lanes)) {
    ctx.beginPath();
    lane.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
    ctx.stroke();
  }

  // Entities.
  for (const e of map.data.entities) {
    const style = ENTITY_STYLE[e.kind];
    if (!style) continue;
    ctx.fillStyle = style.color;
    ctx.strokeStyle = e.team === 'sentinel' ? '#0f0' : e.team === 'scourge' ? '#f00' : '#000';
    ctx.beginPath();
    ctx.arc(sx(e.x), sy(e.y), style.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const count = (kind: MapEntityKind, team: string): number =>
    map.data.entities.filter((e) => e.kind === kind && e.team === team).length;
  ui.innerHTML = `<pre style="position:fixed;right:8px;top:8px;margin:0;background:#000a;padding:8px;font-size:12px">source: ${map.data.source}
trees: ${map.data.trees.length}
towers S/U: ${count('tower', 'sentinel')}/${count('tower', 'scourge')}
rax S/U: ${count('barracks_melee', 'sentinel') + count('barracks_ranged', 'sentinel')}/${count('barracks_melee', 'scourge') + count('barracks_ranged', 'scourge')}</pre>`;
  markSceneReady();
};
