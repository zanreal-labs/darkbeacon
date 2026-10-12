// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTelemetry, flushTelemetry, resetTelemetry, track } from './telemetry';

type Body = { events: Array<{ event: string; props: Record<string, unknown> }> };

describe('track', () => {
  let sent: Body[];

  beforeEach(() => {
    sent = [];
    resetTelemetry();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)) as Body);
        return new Response(null, { status: 202 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  });

  it('batches catalogued events to the own server once telemetry is on', () => {
    track('panel_opened', { panel: 'signatures' });
    track('shortcut_used', { shortcut: 'fit_chain' });
    expect(sent).toEqual([]);
    configureTelemetry(true);
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([
      {
        events: [
          { event: 'panel_opened', props: { panel: 'signatures' } },
          { event: 'shortcut_used', props: { shortcut: 'fit_chain' } },
        ],
      },
    ]);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/telemetry/e');
  });

  it('drops events and props that are not on the allow-list', () => {
    configureTelemetry(true);
    // @ts-expect-error not in the catalogue
    track('system_viewed', { system: 'Jita' });
    // @ts-expect-error not in the catalogue
    track('panel_opened', { panel: 'signatures', system: 'J123456' });
    flushTelemetry();
    expect(sent).toEqual([]);
  });

  it('sends nothing when the server says telemetry is off', () => {
    track('panel_opened', { panel: 'local' });
    configureTelemetry(false);
    track('panel_opened', { panel: 'local' });
    vi.advanceTimersByTime(60_000);
    flushTelemetry();
    expect(sent).toEqual([]);
  });

  it('respects Do Not Track in the browser', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    configureTelemetry(true);
    track('panel_opened', { panel: 'local' });
    flushTelemetry();
    expect(sent).toEqual([]);
  });
});
