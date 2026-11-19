import { describe, expect, it } from 'vitest';
import { gameLifetime, gameLifetimePatch, GameLifetime } from './mapping.js';

const H = 3_600_000;
const NOW = 100 * H;
const hole = (extra: Partial<Parameters<typeof gameLifetime>[0]> = {}) => ({
  timeStatus: 'normal' as const,
  eolAt: null,
  lifetime: null,
  ...extra,
});

describe('the game lifetime of a connection', () => {
  it('is less than a day while nobody marked it', () => {
    expect(gameLifetime(hole(), NOW)).toBe('day');
    // A lifetime mark that still leaves more than 4 hours says no more than the game does.
    expect(gameLifetime(hole({ lifetime: { mark: '16h', at: NOW - H } }), NOW)).toBe('day');
  });

  it('counts down from EOL: under 4 hours, then under 1 hour, then expired', () => {
    expect(gameLifetime(hole({ timeStatus: 'eol', eolAt: NOW }), NOW)).toBe('4h');
    expect(gameLifetime(hole({ timeStatus: 'eol', eolAt: NOW - 3.5 * H }), NOW)).toBe('1h');
    expect(gameLifetime(hole({ timeStatus: 'eol', eolAt: NOW - 5 * H }), NOW)).toBe('expired');
  });

  it('takes whichever mark leaves less, and an expired mark at once', () => {
    expect(
      gameLifetime(hole({ timeStatus: 'eol', eolAt: NOW, lifetime: { mark: '1h', at: NOW } }), NOW),
    ).toBe('1h');
    expect(gameLifetime(hole({ lifetime: { mark: '16h', at: NOW - 13 * H } }), NOW)).toBe('4h');
    expect(
      gameLifetime(hole({ timeStatus: 'eol', eolAt: NOW, lifetime: { mark: 'expired', at: NOW } }), NOW),
    ).toBe('expired');
  });

  it('reads back as the state it was marked with', () => {
    for (const state of GameLifetime.options) {
      const patch = gameLifetimePatch(state);
      const marked = hole({
        timeStatus: patch.timeStatus,
        eolAt: patch.timeStatus === 'eol' ? NOW : null,
        lifetime: patch.lifetime ? { mark: patch.lifetime, at: NOW } : null,
      });
      expect(gameLifetime(marked, NOW)).toBe(state);
    }
  });
});
