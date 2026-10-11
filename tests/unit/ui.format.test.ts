import { describe, expect, it } from 'vitest';
import { cooldownFraction, formatClock, formatCooldown, formatDamage, formatGold, formatSeconds, xpProgress } from '../../src/ui/format';
import { HERO_XP } from '../../src/data';

describe('ui cooldown formatting', () => {
  it('is empty when ready', () => {
    expect(formatCooldown(0)).toBe('');
    expect(formatCooldown(-1)).toBe('');
    expect(formatCooldown(Number.NaN)).toBe('');
  });
  it('shows one decimal under 3 s, rounding up', () => {
    expect(formatCooldown(2.94)).toBe('3.0');
    expect(formatCooldown(1.21)).toBe('1.3');
    expect(formatCooldown(0.01)).toBe('0.1');
  });
  it('shows whole seconds rounded up from 3 s', () => {
    expect(formatCooldown(3)).toBe('3');
    expect(formatCooldown(19.2)).toBe('20');
    expect(formatCooldown(65)).toBe('65');
  });
  it('sweep fraction is clamped', () => {
    expect(cooldownFraction(5, 20)).toBeCloseTo(0.25);
    expect(cooldownFraction(30, 20)).toBe(1);
    expect(cooldownFraction(0, 20)).toBe(0);
    expect(cooldownFraction(3, 0)).toBe(0);
  });
});

describe('ui clock and numbers', () => {
  it('formats the match clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-45)).toBe('-0:45');
    expect(formatClock(-89.5)).toBe('-1:30');
  });
  it('formats gold, seconds and damage', () => {
    expect(formatGold(625)).toBe('625');
    expect(formatGold(12345.7)).toBe('12,345');
    expect(formatGold(-3)).toBe('0');
    expect(formatSeconds(4.2)).toBe('5');
    expect(formatSeconds(-1)).toBe('0');
    expect(formatDamage(0.2)).toBe('1');
    expect(formatDamage(90.6)).toBe('91');
  });
  it('xp progress uses the cumulative 6.83d table', () => {
    const t = HERO_XP.totalXpForLevel;
    expect(xpProgress(0, 1, t)).toBe(0);
    expect(xpProgress(100, 1, t)).toBeCloseTo(0.5);
    expect(xpProgress(350, 2, t)).toBeCloseTo(0.5);
    expect(xpProgress(99999, 25, t)).toBe(1);
  });
});
