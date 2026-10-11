// World (WC3: X east, Y north) ↔ minimap pixel transform. North-up, uniform scale (the playable
// area is letterboxed into the square), pixel (0,0) = top-left. Pure, covered by ui.minimap.test.ts.

export interface MinimapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MinimapTransform {
  /** Pixels per world unit. */
  scale: number;
  /** Pixel offsets that centre the playable area in the square. */
  offsetX: number;
  offsetY: number;
  size: number;
  bounds: MinimapBounds;
}

export const createMinimapTransform = (bounds: MinimapBounds, size: number): MinimapTransform => {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const scale = size / Math.max(w, h);
  return { scale, offsetX: (size - w * scale) / 2, offsetY: (size - h * scale) / 2, size, bounds };
};

export interface Point {
  x: number;
  y: number;
}

/** World → minimap pixels. Writes into `out` (no allocation in the draw loop). */
export const worldToMinimap = (t: MinimapTransform, x: number, y: number, out: Point = { x: 0, y: 0 }): Point => {
  out.x = t.offsetX + (x - t.bounds.minX) * t.scale;
  out.y = t.offsetY + (t.bounds.maxY - y) * t.scale;
  return out;
};

/** Minimap pixels → world. */
export const minimapToWorld = (t: MinimapTransform, px: number, py: number, out: Point = { x: 0, y: 0 }): Point => {
  out.x = t.bounds.minX + (px - t.offsetX) / t.scale;
  out.y = t.bounds.maxY - (py - t.offsetY) / t.scale;
  return out;
};

/**
 * WC3 yaw (radians, 0 = east, CCW) → canvas angle for ctx.arc / rotate on a north-up minimap
 * (canvas y grows downwards, so the angle flips sign).
 */
export const yawToCanvasAngle = (yaw: number): number => -yaw;
