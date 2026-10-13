import { afterEach, describe, expect, it, vi } from 'vitest';
import { peakHours } from './ActivitySection';

const at = (iso: string) => ({ time: iso });
const KILLS = [at('2026-10-10T18:05:00Z'), at('2026-10-11T19:40:00Z'), at('2026-10-12T20:10:00Z')];
const NOW = new Date('2026-10-13T12:00:00Z');

describe('peakHours', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('says nothing from fewer than three killmails', () => {
    expect(peakHours(KILLS.slice(0, 2), NOW)).toBeNull();
  });

  it('shows the busiest hours on the viewer’s clock, not EVE time', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(peakHours(KILLS, NOW)).toBe('18–21');
    vi.stubEnv('TZ', 'Europe/Warsaw');
    expect(peakHours(KILLS, NOW)).toBe('20–23');
    vi.stubEnv('TZ', 'Asia/Kolkata');
    expect(peakHours(KILLS, NOW)).toBe('23:30–02:30');
  });
});
