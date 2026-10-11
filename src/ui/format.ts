// Pure formatting helpers for the HUD (covered by tests/unit/ui.format.test.ts).

/**
 * Cooldown text shown over an ability icon: '' when ready, one decimal under 3 s (so the last moments
 * read precisely), otherwise whole seconds rounded up (WC3 / CS style).
 */
export const formatCooldown = (remaining: number): string => {
  if (!(remaining > 0)) return '';
  if (remaining < 3) return (Math.ceil(remaining * 10) / 10).toFixed(1);
  return String(Math.ceil(remaining));
};

/** Fraction of the cooldown still remaining (1 = just used, 0 = ready). */
export const cooldownFraction = (remaining: number, total: number): number => {
  if (!(remaining > 0) || !(total > 0)) return 0;
  return Math.min(1, remaining / total);
};

/** Match clock: m:ss (h:mm:ss past an hour); negative before the horn, e.g. -0:45. */
export const formatClock = (seconds: number): string => {
  const neg = seconds < 0;
  // Pre-game counts up towards 0 like a countdown: -0:45 at 45 s before the horn.
  const t = neg ? Math.ceil(-seconds) : Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return neg ? `-${body}` : body;
};

/** Whole seconds for respawn / death timers. */
export const formatSeconds = (seconds: number): string => String(Math.max(0, Math.ceil(seconds)));

/** Thousands separator without locale surprises: 12345 → '12,345'. */
export const formatGold = (gold: number): string => {
  const n = Math.floor(Math.max(0, gold));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** Damage number text (no decimals, at least 1). */
export const formatDamage = (amount: number): string => String(Math.max(1, Math.round(amount)));

/** XP progress within the current level, 0..1 (1 at max level). */
export const xpProgress = (xp: number, level: number, totalXpForLevel: readonly number[]): number => {
  if (level >= totalXpForLevel.length) return 1;
  const lo = totalXpForLevel[level - 1] ?? 0;
  const hi = totalXpForLevel[level] ?? lo;
  if (hi <= lo) return 1;
  return Math.min(1, Math.max(0, (xp - lo) / (hi - lo)));
};

