import { ManualClock } from '@darkbeacon/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ESI_COMPATIBILITY_DATE, HttpEsiGateway } from './http-esi-gateway.js';

const PILOT = 90000001;

interface Sent {
  url: string;
  headers: Record<string, string>;
}

/** fetch stand-in: answers from a queue and records the requests. No network. */
function fakeFetch(answers: Array<Response | Error>, sent: Sent[]): typeof fetch {
  return (input, init) => {
    sent.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const limits = (remaining: number) => ({
  'x-ratelimit-group': 'char-location',
  'x-ratelimit-limit': '1200/15m',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-used': '2',
});

describe('HttpEsiGateway', () => {
  let clock: ManualClock;
  let sent: Sent[];
  let answers: Array<Response | Error>;
  let esi: HttpEsiGateway;

  beforeEach(() => {
    clock = new ManualClock(Date.UTC(2026, 9, 11, 12, 0, 0));
    sent = [];
    answers = [];
    esi = new HttpEsiGateway({
      clock,
      userAgent: 'Darkbeacon/test',
      baseUrl: 'https://esi.test',
      fetch: fakeFetch(answers, sent),
    });
  });

  it('sends the compatibility date, user agent and token, and maps the body', async () => {
    answers.push(
      reply(
        200,
        { solar_system_id: 30000142, station_id: 60003760 },
        {
          etag: '"abc"',
          date: new Date(clock.now() - 60_000).toUTCString(),
          expires: new Date(clock.now() - 55_000).toUTCString(),
          ...limits(1000),
        },
      ),
    );
    const result = await esi.location(PILOT, 'token');
    expect(sent[0]).toEqual({
      url: `https://esi.test/characters/${PILOT}/location`,
      headers: {
        accept: 'application/json',
        authorization: 'Bearer token',
        'user-agent': 'Darkbeacon/test',
        'x-compatibility-date': ESI_COMPATIBILITY_DATE,
      },
    });
    // Expires is read relative to the server's Date header, so a skewed clock does not matter.
    expect(result).toEqual({
      ok: true,
      data: { solarSystemId: 30000142, stationId: 60003760, structureId: null },
      etag: '"abc"',
      expiresAt: clock.now() + 5_000,
    });
  });

  it('sends If-None-Match and returns no data on 304', async () => {
    answers.push(reply(304, null, { etag: '"abc"', 'cache-control': 'max-age=60' }));
    const result = await esi.online(PILOT, 'token', '"abc"');
    expect(sent[0]?.headers['if-none-match']).toBe('"abc"');
    expect(result).toEqual({ ok: true, data: null, etag: '"abc"', expiresAt: clock.now() + 60_000 });
  });

  it('maps ship and online bodies', async () => {
    answers.push(
      reply(200, { ship_type_id: 587, ship_item_id: 1000000016991, ship_name: 'Rifter' }),
      reply(200, { online: true, last_login: '2026-10-11T10:00:00Z' }),
    );
    expect(await esi.ship(PILOT, 't')).toMatchObject({
      data: { shipTypeId: 587, shipItemId: 1000000016991, shipName: 'Rifter' },
    });
    expect(await esi.online(PILOT, 't')).toMatchObject({
      data: { online: true, lastLogin: Date.UTC(2026, 9, 11, 10) },
    });
  });

  it('honours Retry-After on 429 for that character only', async () => {
    answers.push(reply(429, { error: 'rate limited' }, { 'retry-after': '30', ...limits(0) }));
    expect(await esi.location(PILOT, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 30_000 });

    // Same bucket (group + character): refused without a request.
    expect(await esi.ship(PILOT, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 30_000 });
    expect(sent).toHaveLength(1);

    // Another character has its own bucket.
    answers.push(reply(200, { online: false }, limits(1000)));
    expect(await esi.online(PILOT + 1, 't')).toMatchObject({ ok: true });

    clock.advance(30_000);
    answers.push(reply(200, { online: true }, limits(1000)));
    expect(await esi.online(PILOT, 't')).toMatchObject({ ok: true });
  });

  it('slows down a bucket that is almost empty', async () => {
    answers.push(reply(200, { online: true }, limits(100)));
    expect(await esi.online(PILOT, 't')).toMatchObject({ ok: true });
    // A tenth of the 15 minute window.
    expect(await esi.location(PILOT, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 90_000 });
    expect(sent).toHaveLength(1);
  });

  it('stops every request before the error limit runs out and after a 420', async () => {
    answers.push(reply(500, {}, { 'x-esi-error-limit-remain': '5', 'x-esi-error-limit-reset': '40' }));
    expect(await esi.location(PILOT, 't')).toMatchObject({ ok: false });
    expect(await esi.location(PILOT + 1, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 40_000 });
    expect(sent).toHaveLength(1);

    clock.advance(40_000);
    answers.push(reply(420, {}, { 'retry-after': '20' }));
    expect(await esi.online(PILOT, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 20_000 });
    expect(await esi.online(PILOT + 1, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 20_000 });
    expect(sent).toHaveLength(2);
  });

  it('backs off exponentially on server and network errors and resets on success', async () => {
    answers.push(reply(503, {}), new TypeError('fetch failed'), reply(502, {}));
    const retries = [];
    for (let i = 0; i < 3; i++) {
      const result = await esi.location(PILOT, 't');
      retries.push(result.ok ? 0 : result.retryAt - clock.now());
    }
    expect(retries).toEqual([5_000, 10_000, 20_000]);

    answers.push(reply(200, { solar_system_id: 1 }), reply(503, {}));
    await esi.location(PILOT, 't');
    expect(await esi.location(PILOT, 't')).toMatchObject({ retryAt: clock.now() + 5_000 });
  });

  it('prefers Cache-Control over Expires', async () => {
    answers.push(
      reply(
        200,
        { online: true },
        { 'cache-control': 'private, max-age=60', expires: new Date(clock.now()).toUTCString() },
      ),
    );
    expect(await esi.online(PILOT, 't')).toMatchObject({ expiresAt: clock.now() + 60_000 });
  });

  it('counts its own errors and stops for the minute at half of the error limit', async () => {
    // Rate-limited routes carry no X-ESI-Error-Limit-* headers; 404s from many characters.
    for (let i = 0; i < 50; i++) answers.push(reply(404, { error: 'not found' }, limits(1000)));
    for (let i = 0; i < 50; i++) await esi.location(PILOT + i, 't');
    expect(sent).toHaveLength(50);
    clock.advance(10_000);
    expect(await esi.location(PILOT + 99, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 50_000 });
    expect(sent).toHaveLength(50);
    // 429s do not count against it.
    clock.advance(50_000);
    for (let i = 0; i < 60; i++) answers.push(reply(429, {}, { 'retry-after': '1' }));
    for (let i = 0; i < 60; i++) await esi.location(PILOT + 100 + i, 't');
    expect(sent).toHaveLength(110);
  });

  it('pauses every character when ESI is down, longer each time, until it answers again', async () => {
    for (let i = 0; i < 5; i++) answers.push(reply(503, {}));
    for (let i = 0; i < 5; i++) await esi.location(PILOT + i, 't');
    expect(await esi.location(PILOT + 10, 't')).toMatchObject({ ok: false, retryAt: clock.now() + 5_000 });
    expect(sent).toHaveLength(5);
    clock.advance(5_000);
    for (let i = 0; i < 5; i++) answers.push(new TypeError('fetch failed'));
    for (let i = 0; i < 5; i++) await esi.location(PILOT + 20 + i, 't');
    expect(await esi.location(PILOT + 30, 't')).toMatchObject({ retryAt: clock.now() + 10_000 });
    clock.advance(10_000);
    answers.push(reply(200, { solar_system_id: 1 }));
    expect(await esi.location(PILOT + 40, 't')).toMatchObject({ ok: true });
    for (let i = 0; i < 5; i++) answers.push(reply(502, {}));
    for (let i = 0; i < 5; i++) await esi.location(PILOT + 50 + i, 't');
    expect(await esi.location(PILOT + 60, 't')).toMatchObject({ retryAt: clock.now() + 5_000 });
  });

  it('waits long after authorization errors', async () => {
    answers.push(reply(403, { error: 'token is not valid for scope(s)' }));
    expect(await esi.location(PILOT, 't')).toMatchObject({
      ok: false,
      retryAt: clock.now() + 5 * 60_000,
      reason: 'HTTP 403',
    });
  });
});
