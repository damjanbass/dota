import { describe, expect, it } from 'vitest';
import { KillFeedQueue } from '../../src/ui/killFeedQueue';

const line = (victim: string) => ({
  killer: 'Sniper',
  killerTeam: 'sentinel' as const,
  victim,
  victimTeam: 'scourge' as const,
  icon: 'rifle' as const,
  involvesPlayer: true,
});

describe('ui kill feed queue', () => {
  it('keeps newest last and drops the oldest past the max', () => {
    const q = new KillFeedQueue({ max: 3, ttl: 6 });
    for (const v of ['a', 'b', 'c', 'd']) q.push(line(v), 0);
    expect(q.entries().map((e) => e.victim)).toEqual(['b', 'c', 'd']);
  });

  it('expires lines after the ttl and bumps the version only on change', () => {
    const q = new KillFeedQueue({ max: 5, ttl: 6 });
    q.push(line('a'), 0);
    q.push(line('b'), 4);
    const v = q.version;
    expect(q.prune(5)).toBe(false);
    expect(q.version).toBe(v);
    expect(q.prune(6.01)).toBe(true);
    expect(q.entries().map((e) => e.victim)).toEqual(['b']);
    expect(q.version).toBe(v + 1);
    q.prune(11);
    expect(q.entries()).toHaveLength(0);
  });

  it('assigns unique ids and clears', () => {
    const q = new KillFeedQueue();
    const a = q.push(line('a'), 0);
    const b = q.push(line('b'), 0);
    expect(a.id).not.toBe(b.id);
    q.clear();
    expect(q.entries()).toHaveLength(0);
  });
});
