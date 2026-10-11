import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/ui/settings';

describe('ui settings', () => {
  it('falls back to defaults for junk', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ fov: 'wide', sensitivity: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps out-of-range values and keeps valid ones', () => {
    const s = sanitizeSettings({ fov: 200, sensitivity: 3.5, masterVolume: -1, sfxVolume: 0.5, shrapnelQuickCast: false, extra: 1 });
    expect(s).toEqual({ fov: 110, sensitivity: 3.5, masterVolume: 0, sfxVolume: 0.5, shrapnelQuickCast: false });
  });
});
