// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY } from './settings';

describe('loadSettings', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts in the jump mode', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ version: 4, mode: 'jump' });
  });

  it('keeps the travel mode saved by this version', () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 4, mode: 'travel', ship: 'Ark' }));
    expect(loadSettings()).toMatchObject({ version: 4, mode: 'travel', ship: 'Ark' });
  });

  it('reads settings saved before the travel mode as the jump mode, the rest kept', () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 3, ship: 'Avatar', preferStations: false, mode: 'travel' }),
    );
    expect(loadSettings()).toMatchObject({ version: 4, mode: 'jump', ship: 'Avatar', preferStations: false });
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 4, mode: 'warp' }));
    expect(loadSettings().mode).toBe('jump');
  });
});
