// What a bot "knows" about enemy heroes: only what its team can see (sim.isVisibleTo), delayed by its
// reaction time. Keeps a short position history per enemy hero for velocity estimates (skillshot lead).
import type { SimApi, UnitState } from '../core/sim';
import type { Team, Vec2 } from '../core/types';

interface Track {
  firstSeen: number;
  lastSeen: number;
  lastPos: Vec2;
  samples: Array<{ t: number; x: number; y: number }>;
}

const HISTORY = 2;
/** A hero unseen for longer than this counts as "newly seen" again (needs another reaction delay). */
const FORGET = 0.5;

export class Perception {
  private readonly team: Team;
  private readonly reaction: number;
  private readonly tracks = new Map<number, Track>();
  private now = 0;

  constructor(team: Team, reactionTime: number) {
    this.team = team;
    this.reaction = reactionTime;
  }

  update(sim: SimApi): void {
    this.now = sim.time;
    for (const u of sim.units()) {
      if (u.kind !== 'hero' || u.team === this.team) continue;
      const visible = u.alive && sim.isVisibleTo(this.team, u.id);
      let tr = this.tracks.get(u.id);
      if (!visible) {
        if (tr && !u.alive) tr.samples.length = 0;
        continue;
      }
      if (!tr) {
        tr = { firstSeen: sim.time, lastSeen: sim.time, lastPos: { x: u.position.x, y: u.position.y }, samples: [] };
        this.tracks.set(u.id, tr);
      } else if (sim.time - tr.lastSeen > FORGET) {
        tr.firstSeen = sim.time;
        tr.samples.length = 0;
      }
      tr.lastSeen = sim.time;
      tr.lastPos = { x: u.position.x, y: u.position.y };
      tr.samples.push({ t: sim.time, x: u.position.x, y: u.position.y });
      while (tr.samples.length > 0 && tr.samples[0]!.t < sim.time - HISTORY) tr.samples.shift();
    }
  }

  /** Visible now and seen for at least the reaction time. */
  knows(u: UnitState): boolean {
    const tr = this.tracks.get(u.id);
    return !!tr && u.alive && tr.lastSeen >= this.now - 1e-6 && this.now - tr.firstSeen >= this.reaction - 1e-6;
  }

  /** Position the bot believes the hero is at: the sample one reaction time old. */
  believedPosition(u: UnitState): Vec2 {
    return this.sampleAt(u.id, this.now - this.reaction) ?? { x: u.position.x, y: u.position.y };
  }

  /** Velocity estimate from delayed samples (units/s). */
  velocity(u: UnitState, window = 0.3): Vec2 {
    const t1 = this.now - this.reaction;
    const a = this.sampleAt(u.id, t1 - window);
    const b = this.sampleAt(u.id, t1);
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (b.x - a.x) / window, y: (b.y - a.y) / window };
  }

  /** Last place and time the team saw this hero (for ganks / chases), or null. */
  lastSeen(unitId: number): { pos: Vec2; time: number } | null {
    const tr = this.tracks.get(unitId);
    return tr ? { pos: tr.lastPos, time: tr.lastSeen } : null;
  }

  private sampleAt(unitId: number, t: number): Vec2 | null {
    const s = this.tracks.get(unitId)?.samples;
    if (!s || s.length === 0) return null;
    if (t <= s[0]!.t) return { x: s[0]!.x, y: s[0]!.y };
    for (let i = s.length - 1; i >= 0; i--) {
      const p = s[i]!;
      if (p.t <= t) {
        const n = s[i + 1];
        if (!n) return { x: p.x, y: p.y };
        const f = (t - p.t) / (n.t - p.t);
        return { x: p.x + (n.x - p.x) * f, y: p.y + (n.y - p.y) * f };
      }
    }
    return { x: s[0]!.x, y: s[0]!.y };
  }
}
