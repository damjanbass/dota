// Player settings (menu + pause), persisted in localStorage. Storage can be missing or throw
// (private mode, blocked site data), so every access is wrapped and defaults always work.

export interface GameSettings {
  /** CS-style mouse sensitivity (player InputSettings.sensitivity). */
  sensitivity: number;
  /** Unscoped CS FOV (horizontal degrees at 4:3; player ScopeParams.fovs[0]). */
  fov: number;
  /** Q fires Shrapnel at the crosshair immediately; false = Q arms it and LMB confirms. */
  shrapnelQuickCast: boolean;
  /** 0..1 */
  masterVolume: number;
  /** 0..1 */
  sfxVolume: number;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  sensitivity: 2,
  fov: 90,
  shrapnelQuickCast: true,
  masterVolume: 0.8,
  sfxVolume: 0.9,
};

export const SETTINGS_LIMITS = {
  sensitivity: { min: 0.2, max: 10, step: 0.1 },
  fov: { min: 75, max: 110, step: 1 },
  masterVolume: { min: 0, max: 1, step: 0.01 },
  sfxVolume: { min: 0, max: 1, step: 0.01 },
} as const;

const STORAGE_KEY = 'dota-sniper-fps:settings';

const num = (v: unknown, fallback: number, lim: { min: number; max: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : fallback;

/** Clamps / repairs anything read from storage. Unknown keys are dropped. */
export const sanitizeSettings = (raw: unknown): GameSettings => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    sensitivity: num(o.sensitivity, d.sensitivity, SETTINGS_LIMITS.sensitivity),
    fov: num(o.fov, d.fov, SETTINGS_LIMITS.fov),
    shrapnelQuickCast: typeof o.shrapnelQuickCast === 'boolean' ? o.shrapnelQuickCast : d.shrapnelQuickCast,
    masterVolume: num(o.masterVolume, d.masterVolume, SETTINGS_LIMITS.masterVolume),
    sfxVolume: num(o.sfxVolume, d.sfxVolume, SETTINGS_LIMITS.sfxVolume),
  };
};

let current: GameSettings | null = null;
const listeners = new Set<(s: GameSettings) => void>();

export const loadSettings = (): GameSettings => {
  if (current) return { ...current };
  let raw: unknown = null;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = null;
  }
  current = sanitizeSettings(raw);
  return { ...current };
};

/** Saves (best effort) and notifies subscribers (audio volumes, player sensitivity / FOV). */
export const saveSettings = (patch: Partial<GameSettings>): GameSettings => {
  current = sanitizeSettings({ ...loadSettings(), ...patch });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: settings still apply for this session.
  }
  const snapshot = { ...current };
  for (const fn of listeners) fn(snapshot);
  return snapshot;
};

export const onSettingsChange = (fn: (s: GameSettings) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
