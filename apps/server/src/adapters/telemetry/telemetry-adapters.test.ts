import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { pseudonymousId } from '@darkbeacon/telemetry';
import { KyselyTelemetryState } from './kysely-telemetry-state.js';
import { Backoff, hmacSha256, PostHogSink } from './posthog-sink.js';

const clockAt = (time = 1_000_000) => ({
  time,
  now() {
    return this.time;
  },
});

describe('pseudonymous account ids', () => {
  const account = '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11';

  it('are an HMAC-SHA256 of the account id: stable, not the raw id, per instance', () => {
    const id = pseudonymousId(hmacSha256, 'instance-secret', account);
    expect(id).toBe(pseudonymousId(hmacSha256, 'instance-secret', account));
    expect(id).toMatch(/^u_[0-9a-f]{32}$/);
    expect(id).not.toContain(account);
    expect(id).not.toContain(account.replaceAll('-', '').slice(0, 8));
    expect(pseudonymousId(hmacSha256, 'other-instance', account)).not.toBe(id);
    expect(pseudonymousId(hmacSha256, 'instance-secret', `${account}x`)).not.toBe(id);
    // RFC 4231 test case 2: the HMAC itself is the standard one.
    expect(hmacSha256('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('Backoff', () => {
  it('waits longer after each failure and resets after a success', async () => {
    const clock = clockAt();
    const backoff = new Backoff(clock, 1000, 8000);
    let answer: number | Error = new Error('offline');
    let calls = 0;
    const fetch = backoff.wrap(async () => {
      calls++;
      if (answer instanceof Error) throw answer;
      return new Response('', { status: answer });
    });
    await expect(fetch('http://x')).rejects.toThrow('offline');
    const first = backoff.retryAt - clock.time;
    expect(first).toBeGreaterThanOrEqual(750);
    await expect(fetch('http://x')).rejects.toThrow(/backing off/);
    expect(calls).toBe(1);
    clock.time = backoff.retryAt;
    answer = 503;
    await expect(fetch('http://x')).rejects.toThrow(/503/);
    expect(backoff.retryAt - clock.time).toBeGreaterThan(first);
    clock.time = backoff.retryAt;
    answer = 200;
    expect((await fetch('http://x')).status).toBe(200);
    expect(backoff.retryAt).toBe(0);
    // A client error (a wrong key) is not retried.
    answer = 401;
    expect((await fetch('http://x')).status).toBe(401);
  });
});

describe('PostHogSink', () => {
  it('keeps events while the endpoint is unreachable and delivers them once it is back', async () => {
    const clock = clockAt();
    const received: Array<{ event: string; properties: Record<string, unknown> }> = [];
    let online = false;
    const sink = new PostHogSink({
      key: 'phc_test',
      host: 'http://posthog.test',
      clock,
      flushAt: 1000,
      flushIntervalMs: 0,
      fetch: async (_url, init) => {
        if (!online) throw new Error('ECONNREFUSED');
        const body = Buffer.from(await new Response(init?.body).arrayBuffer());
        const gzip = new Headers(init?.headers).get('content-encoding') === 'gzip';
        received.push(...JSON.parse((gzip ? gunzipSync(body) : body).toString()).batch);
        return new Response('{}', { status: 200 });
      },
    });
    const event = (n: number) => ({
      uuid: `0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c${String(n).padStart(2, '0')}`,
      event: 'map_created',
      distinctId: 'u_x',
      properties: { origin: 'server', $ip: '203.0.113.9' },
      timestamp: clock.time,
    });
    sink.capture(event(1));
    sink.capture(event(2));
    await sink.flush();
    expect(received).toEqual([]);
    online = true;
    await sink.flush(); // still backing off
    expect(received).toEqual([]);
    clock.time += 60 * 60 * 1000;
    await sink.flush();
    expect(received.map((e) => e.event)).toEqual(['map_created', 'map_created']);
    for (const e of received) {
      expect(e.properties).toMatchObject({ $ip: null, $geoip_disable: true, $process_person_profile: false });
    }
    await sink.flush();
    expect(received).toHaveLength(2);
    await sink.shutdown(1000);
  });
});

describeEachDialect('KyselyTelemetryState', (t) => {
  it('creates the instance identity once and keeps the switch, heartbeat and notices', async () => {
    const state = new KyselyTelemetryState(t.db);
    const identity = await state.identity();
    expect(identity.instanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.secret.length).toBeGreaterThanOrEqual(40);
    expect(await new KyselyTelemetryState(t.db).identity()).toEqual(identity);

    expect(await state.adminEnabled()).toBeNull();
    await state.setAdminEnabled(false);
    expect(await state.adminEnabled()).toBe(false);
    await state.setAdminEnabled(true);
    expect(await state.adminEnabled()).toBe(true);

    expect(await state.lastHeartbeatAt()).toBeNull();
    await state.setLastHeartbeatAt(1234);
    expect(await state.lastHeartbeatAt()).toBe(1234);

    expect(await state.noticeDismissed('a')).toBe(false);
    await state.dismissNotice('a', 1);
    await state.dismissNotice('a', 2);
    expect(await state.noticeDismissed('a')).toBe(true);
  });
});
