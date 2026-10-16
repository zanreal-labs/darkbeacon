import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  ConnectionDto,
  MapDto,
  MeDto,
  TelemetryClientDto,
  TelemetryStatusDto,
} from '@darkbeacon/shared';
import { TelemetryService } from '@darkbeacon/telemetry';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { tempDir } from '../../plugins/packages.test-support.js';
import { Browser } from '../../test-support/browser.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const HOST = 'http://posthog.test';

interface Captured {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

describeEachDialect('telemetry over HTTP', (t) => {
  let app: NestFastifyApplication | undefined;
  let base: string;
  let batches: Array<{ api_key: string; batch: Captured[] }>;

  /** PostHog's /batch/ endpoint; everything else the server fetches is answered 404. */
  const posthog = async (url: string, init?: RequestInit) => {
    if (!url.startsWith(HOST)) return new Response('', { status: 404 });
    const raw = Buffer.from(await new Response(init?.body).arrayBuffer());
    const gzip = new Headers(init?.headers).get('content-encoding') === 'gzip';
    batches.push(JSON.parse((gzip ? gunzipSync(raw) : raw).toString('utf8')));
    return new Response('{"status":1}', { status: 200 });
  };

  const start = async (env: Record<string, string> = {}) => {
    for (const [key, value] of Object.entries({
      TELEMETRY_POSTHOG_KEY: 'phc_test',
      TELEMETRY_POSTHOG_HOST: HOST,
      ...env,
    }))
      vi.stubEnv(key, value);
    const config = {
      ...parseEnv({
        NODE_ENV: env.NODE_ENV ?? 'production',
        DEMO_MODE: 'true',
        ALLOW_DEMO_MODE: 'true',
        DATA_DIR: tempDir('dbk-telemetry-'),
      }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false, fetch: posthog });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  const signIn = async (name: string) => {
    const browser = new Browser(base);
    const me = await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Pilot` } },
    });
    return { browser, me };
  };

  const sent = async () => {
    await app!.get(TelemetryService).flush();
    return batches.flatMap((b) => b.batch);
  };

  beforeEach(() => {
    batches = [];
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  it('reports feature use anonymously, through the allow-list, and shows it to admins', async () => {
    await start();
    const { browser: owner, me } = await signIn('Owner Person');
    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Secret Chain' } });
    const m = `/api/maps/${map.id}`;
    await owner.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    await owner.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: PERIMETER } });
    const connection = await owner.json<ConnectionDto>(`${m}/connections`, {
      method: 'POST',
      json: { source: JITA, target: PERIMETER },
    });
    await owner.json(`${m}/connections/${connection.id}`, { method: 'PATCH', json: { timeStatus: 'eol' } });
    await owner.json(`${m}/route?from=${JITA}&to=${PERIMETER}&mode=outlaw`);
    await owner.json(`${m}/systems/${JITA}/signatures/paste`, {
      method: 'POST',
      json: { text: 'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t0.0%\t4.20 AU' },
    });

    const web = await owner.request('/api/telemetry/e', {
      method: 'POST',
      json: { events: [{ event: 'panel_opened', props: { panel: 'signatures' } }] },
    });
    expect(web.status).toBe(202);
    expect(await web.json()).toEqual({ accepted: 1 });

    const events = await sent();
    expect(batches.every((b) => b.api_key === 'phc_test')).toBe(true);
    const names = events.map((e) => e.event);
    expect(names).toEqual(
      expect.arrayContaining([
        'signed_in',
        'map_created',
        'system_added',
        'connection_added',
        'connection_updated',
        'route_computed',
        'signatures_pasted',
        'panel_opened',
      ]),
    );
    expect(events.find((e) => e.event === 'connection_updated')?.properties).toMatchObject({
      field: 'eol',
      source: 'manual',
    });
    expect(events.find((e) => e.event === 'route_computed')?.properties).toMatchObject({ mode: 'outlaw' });
    for (const event of events) {
      expect(event.properties).toMatchObject({
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
      });
      expect(event.distinct_id).not.toBe(me.account.id);
    }
    const wire = JSON.stringify(batches);
    for (const secret of [
      'Owner Person',
      'Secret Chain',
      map.slug,
      map.id,
      me.account.id,
      String(JITA),
      'Jita',
    ])
      expect(wire, secret).not.toContain(secret);

    const status = await owner.json<TelemetryStatusDto>('/api/admin/telemetry');
    expect(status).toMatchObject({ active: true, reason: null, host: HOST, keyConfigured: true });
    expect(status.recent.length).toBeGreaterThan(0);
    expect(status.heartbeatPreview.properties).toMatchObject({ maps: 1, accounts: 1, db: t.dialect });
    expect(await owner.json<TelemetryClientDto>('/api/telemetry')).toEqual({ active: true, notice: true });
    expect((await owner.request('/api/admin/telemetry/notice', { method: 'POST' })).status).toBe(204);
    expect(await owner.json<TelemetryClientDto>('/api/telemetry')).toEqual({ active: true, notice: false });
  });

  it('refuses web events that are not on the allow-list', async () => {
    await start();
    const { browser } = await signIn('Owner Person');
    for (const body of [
      { events: [{ event: 'system_viewed', props: { system: 'Jita' } }] },
      { events: [{ event: 'panel_opened', props: { panel: 'local', character: 'Owner Pilot' } }] },
      { events: [{ event: 'panel_opened', props: { panel: 'local' } }], extra: 1 },
      { events: [] },
    ]) {
      expect((await browser.request('/api/telemetry/e', { method: 'POST', json: body })).status).toBe(400);
    }
    const anonymous = new Browser(base).request('/api/telemetry/e', {
      method: 'POST',
      json: { events: [{ event: 'panel_opened', props: { panel: 'local' } }] },
    });
    expect((await anonymous).status).toBe(401);
    expect((await sent()).filter((e) => e.event === 'panel_opened')).toEqual([]);
  });

  it('stops sending when an admin turns it off, and records that', async () => {
    await start();
    const { browser: owner } = await signIn('Owner Person');
    const { browser: user } = await signIn('Some User');
    expect(
      (await user.request('/api/admin/telemetry/enabled', { method: 'PUT', json: { enabled: false } }))
        .status,
    ).toBe(403);
    const off = await owner.json<TelemetryStatusDto>('/api/admin/telemetry/enabled', {
      method: 'PUT',
      json: { enabled: false },
    });
    expect(off).toMatchObject({ active: false, reason: 'admin_disabled', adminEnabled: false });
    const before = (await sent()).length;
    await owner.json('/api/maps', { method: 'POST', json: { name: 'Quiet' } });
    expect((await sent()).length).toBe(before);
    const audit = await owner.json<{ entries: Array<{ type: string }> }>('/api/admin/audit');
    expect(audit.entries.map((e) => e.type)).toContain('telemetry.changed');
  });

  it.each([
    ['TELEMETRY=off', { TELEMETRY: 'off' }, 'env_opt_out'],
    ['DO_NOT_TRACK=1', { DO_NOT_TRACK: '1' }, 'do_not_track'],
    // The build carries the maintainers' key, so an empty TELEMETRY_POSTHOG_KEY falls back to it;
    // an unusable host is what leaves an instance without one.
    ['a host that is not a URL', { TELEMETRY_POSTHOG_HOST: 'not a url' }, 'no_key'],
    ['a test server', { NODE_ENV: 'test' }, 'not_production'],
  ])('sends nothing with %s', async (_, env, reason) => {
    await start(env);
    const { browser: owner } = await signIn('Owner Person');
    await owner.json('/api/maps', { method: 'POST', json: { name: 'Quiet' } });
    const web = await owner.json('/api/telemetry/e', {
      method: 'POST',
      json: { events: [{ event: 'panel_opened', props: { panel: 'local' } }] },
    });
    expect(web).toEqual({ accepted: 0 });
    expect(await app!.get(TelemetryService).heartbeatIfDue(0)).toBe(false);
    expect(await sent()).toEqual([]);
    expect(await owner.json<TelemetryStatusDto>('/api/admin/telemetry')).toMatchObject({
      active: false,
      reason,
    });
    expect(await owner.json<TelemetryClientDto>('/api/telemetry')).toEqual({ active: false, notice: false });
  });

  it('sends the heartbeat from the instance id only', async () => {
    await start();
    await signIn('Owner Person');
    const telemetry = app!.get(TelemetryService);
    expect(await telemetry.heartbeatIfDue(86_400_000)).toBe(true);
    expect(await telemetry.heartbeatIfDue(86_400_000)).toBe(false);
    const heartbeat = (await sent()).find((e) => e.event === 'instance_heartbeat')!;
    expect(heartbeat.distinct_id).toBe(heartbeat.properties.instance_id);
    expect(heartbeat.properties).toMatchObject({
      db: t.dialect,
      demo: true,
      accounts: 1,
      login_method: 'eve',
      plugins_first_party: expect.any(Array),
    });
  });
});
