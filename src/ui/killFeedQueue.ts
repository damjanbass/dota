// CS 1.6 death-notice queue: newest at the bottom, at most `max` lines, each lives `ttl` seconds.
// Pure (time is passed in), covered by ui.killfeed.test.ts.
import type { Team } from '../core/types';

export type KillIcon = 'headshot' | 'rifle' | 'shrapnel' | 'assassinate' | 'melee' | 'ranged' | 'tower' | 'spell' | 'deny' | 'skull' | 'firstblood';

export interface KillFeedEntry {
  id: number;
  killer: string | null;
  killerTeam: Team | null;
  victim: string;
  victimTeam: Team;
  icon: KillIcon;
  /** Extra tag after the victim, e.g. 'DENIED' or 'FIRST BLOOD'. */
  tag?: string;
  /** The human player was the killer or the victim (CS draws a highlight box). */
  involvesPlayer: boolean;
  /** Wall time the line was added. */
  at: number;
}

export interface KillFeedOptions {
  max: number;
  ttl: number;
}

export const KILL_FEED_DEFAULTS: Readonly<KillFeedOptions> = { max: 5, ttl: 6 };

export class KillFeedQueue {
  readonly opts: KillFeedOptions;
  private list: KillFeedEntry[] = [];
  private nextId = 1;
  /** Bumped whenever the visible list changes (cheap dirty check for the DOM). */
  version = 0;

  constructor(opts: Partial<KillFeedOptions> = {}) {
    this.opts = { ...KILL_FEED_DEFAULTS, ...opts };
  }

  push(entry: Omit<KillFeedEntry, 'id' | 'at'>, now: number): KillFeedEntry {
    const full: KillFeedEntry = { ...entry, id: this.nextId++, at: now };
    this.list.push(full);
    while (this.list.length > this.opts.max) this.list.shift();
    this.version++;
    return full;
  }

  /** Drops expired lines. Returns true if anything changed. */
  prune(now: number): boolean {
    const before = this.list.length;
    this.list = this.list.filter((e) => now - e.at < this.opts.ttl);
    if (this.list.length !== before) {
      this.version++;
      return true;
    }
    return false;
  }

  /** Oldest first (top of the screen) → newest last. */
  entries(): readonly KillFeedEntry[] {
    return this.list;
  }

  clear(): void {
    if (this.list.length) this.version++;
    this.list = [];
  }
}
