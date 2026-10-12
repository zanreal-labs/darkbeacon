import { ManualClock } from '@darkbeacon/core';
import { describe, expect, it } from 'vitest';
import { ServerStatusWatch } from '../application/settings.js';
import type { ServerStatusReading } from '../ports/index.js';

describe('ServerStatusWatch', () => {
  it('pauses tracking while TQ is down or in VIP, and not when ESI says nothing', async () => {
    let reading: ServerStatusReading = { kind: 'unknown' };
    const watch = new ServerStatusWatch({
      source: { read: () => Promise.resolve(reading) },
      clock: new ManualClock(7),
    });
    await watch.refresh();
    expect(watch.status).toMatchObject({ online: null, trackingPaused: false, checkedAt: 7 });
    reading = { kind: 'up', players: 30_000, vip: false, serverVersion: '1', startedAt: 1 };
    await watch.refresh();
    expect(watch.paused).toBe(false);
    expect(watch.status).toMatchObject({ online: true, players: 30_000 });
    reading = { kind: 'up', players: 0, vip: true, serverVersion: '1', startedAt: 1 };
    await watch.refresh();
    expect(watch.paused).toBe(true);
    reading = { kind: 'down' };
    await watch.refresh();
    expect(watch.status).toMatchObject({ online: false, trackingPaused: true });

    const failing = new ServerStatusWatch({
      source: { read: () => Promise.reject(new Error('offline')) },
      clock: new ManualClock(),
    });
    await failing.refresh();
    expect(failing.paused).toBe(false);
  });
});
