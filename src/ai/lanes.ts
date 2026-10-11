// Lane geometry for bots: arc-length parametrisation of the map's lane polylines (Sentinel → Scourge),
// projection of positions onto lanes, and lane assignment.
import type { LoadedMap } from '../core/map';
import type { Lane, Team, Vec2 } from '../core/types';

export class LaneGeometry {
  readonly lane: Lane;
  readonly points: readonly Vec2[];
  private readonly cum: number[];
  readonly length: number;

  constructor(lane: Lane, points: readonly Vec2[]) {
    this.lane = lane;
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    this.length = this.cum[this.cum.length - 1]!;
  }

  /** Arc length `s` of the closest lane point and the distance to it. */
  project(p: Vec2): { s: number; dist: number } {
    let best = { s: 0, dist: Infinity };
    for (let i = 0; i + 1 < this.points.length; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      if (d < best.dist) best = { s: this.cum[i]! + t * Math.sqrt(len2), dist: d };
    }
    return best;
  }

  /** Point at arc length s (clamped). */
  at(s: number): Vec2 {
    const c = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < c) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i]!;
    const seg = this.cum[i]! - this.cum[i - 1]!;
    const t = seg === 0 ? 0 : (c - this.cum[i - 1]!) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

export type LaneSet = Record<Lane, LaneGeometry>;

export const LANES: readonly Lane[] = ['top', 'mid', 'bot'];

export const laneGeometries = (map: LoadedMap): LaneSet => ({
  top: new LaneGeometry('top', map.data.lanes.top),
  mid: new LaneGeometry('mid', map.data.lanes.mid),
  bot: new LaneGeometry('bot', map.data.lanes.bot),
});

/** +1 for Sentinel (lanes are ordered Sentinel → Scourge), -1 for Scourge. */
export const forwardSign = (team: Team): number => (team === 'scourge' ? -1 : 1);

export const nearestLane = (lanes: LaneSet, p: Vec2): { lane: Lane; s: number; dist: number } => {
  let best = { lane: 'mid' as Lane, s: 0, dist: Infinity };
  for (const lane of LANES) {
    const pr = lanes[lane].project(p);
    if (pr.dist < best.dist) best = { lane, ...pr };
  }
  return best;
};

/** Classic mid heroes first; supports last. */
const MID_PRIORITY = ['shadow_fiend', 'pudge', 'viper', 'lion', 'lich', 'sniper'];

/**
 * Lane per hero for one team. Scourge: one solo mid (best mid hero), then the safe lane (top) and the
 * off lane (bot) alternately. Sentinel bots leave mid to the player: safe lane bot, off lane top.
 */
export const assignLanes = (team: Team, heroIds: readonly string[]): Lane[] => {
  const out: Lane[] = new Array<Lane>(heroIds.length).fill('mid');
  if (heroIds.length === 0) return out;
  const order = heroIds.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id));
  const sides: Lane[] = team === 'scourge' ? ['top', 'bot'] : ['bot', 'top'];
  let k = 0;
  order.forEach(({ i }, n) => {
    if (team === 'scourge' && n === 0) out[i] = 'mid';
    else if (team !== 'scourge' && heroIds.length >= 4 && n === 0) out[i] = 'mid';
    else out[i] = sides[k++ % 2]!;
  });
  return out;
};

const rank = (id: string): number => {
  const i = MID_PRIORITY.indexOf(id);
  return i < 0 ? MID_PRIORITY.length : i;
};
