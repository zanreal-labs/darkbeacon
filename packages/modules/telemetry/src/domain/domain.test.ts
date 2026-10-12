import { describe, expect, it } from 'vitest';
import { countBucket, TELEMETRY_WEB_EVENT_NAMES } from '@darkbeacon/shared';
import { HeartbeatProps, pluginRef, TELEMETRY_CATALOGUE, validateTelemetryEvent } from './catalogue.js';
import { changeSource, featureEvents } from './features.js';
import { piiProblem } from './pii.js';
import { telemetryOffReason, telemetryOptOut } from './policy.js';
import { OBSERVED_ROUTES, requestFeature } from './requests.js';

describe('the allow-list', () => {
  it('accepts a catalogued event with its exact properties', () => {
    expect(validateTelemetryEvent('panel_opened', { panel: 'signatures' })).toEqual({
      ok: true,
      props: { panel: 'signatures' },
    });
    expect(validateTelemetryEvent('map_created', {})).toMatchObject({ ok: true });
  });

  it('rejects unknown events', () => {
    expect(validateTelemetryEvent('character_seen', {})).toMatchObject({ ok: false });
    expect(validateTelemetryEvent('__proto__', {})).toMatchObject({ ok: false });
    expect(validateTelemetryEvent('toString', {})).toMatchObject({ ok: false });
  });

  it('rejects unknown properties and values outside the enums', () => {
    expect(validateTelemetryEvent('panel_opened', { panel: 'signatures', system: 'J123456' })).toMatchObject({
      ok: false,
    });
    expect(validateTelemetryEvent('panel_opened', { panel: 'Jita' })).toMatchObject({ ok: false });
    expect(
      validateTelemetryEvent('route_computed', { mode: 'shortest', skips: 'yes', avoids: false }),
    ).toMatchObject({ ok: false });
    expect(validateTelemetryEvent('system_added', {})).toMatchObject({ ok: false });
  });

  it('rejects values shaped like personal data even where a schema would allow strings', () => {
    const loose = { loose: HeartbeatProps.pick({ db: true }).extend({}).loose() };
    for (const value of [
      'pilot@example.com',
      '192.168.1.20',
      '2001:db8::1',
      '30000142',
      '123456789012345678',
      '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11',
      'Hello there',
      'Jita IV - Moon 4',
    ]) {
      expect(piiProblem(value), value).not.toBeNull();
      expect(validateTelemetryEvent('loose', { db: 'sqlite', extra: value }, loose), value).toMatchObject({
        ok: false,
      });
    }
    expect(piiProblem(2_112_000_000)).not.toBeNull();
    expect(piiProblem(1.5)).not.toBeNull();
    expect(piiProblem({ nested: 'x' })).not.toBeNull();
    for (const fine of ['sqlite', '1001+', '<1s', '0.1.0', 12, true, null])
      expect(piiProblem(fine)).toBeNull();
  });

  it('lists every web event of the shared catalogue', () => {
    for (const name of TELEMETRY_WEB_EVENT_NAMES) expect(TELEMETRY_CATALOGUE).toHaveProperty(name);
  });

  it('names only first-party plugins', () => {
    expect(pluginRef('discord-notify')).toBe('discord-notify');
    expect(pluginRef('my-corp-intel-bot')).toBe('third_party');
  });
});

describe('buckets', () => {
  it('buckets counts', () => {
    expect([0, 1, 3, 10, 11, 60, 999, 5000].map(countBucket)).toEqual([
      '0',
      '1',
      '2-5',
      '6-10',
      '11-25',
      '51-100',
      '251-1000',
      '1001+',
    ]);
  });
});

describe('opting out', () => {
  const on = { key: 'phc_x', env: 'production' as const, optOut: null };

  it('is on only in production with a key and every switch on', () => {
    expect(telemetryOffReason(on, true)).toBeNull();
    expect(telemetryOffReason({ ...on, key: '' }, true)).toBe('no_key');
    expect(telemetryOffReason({ ...on, env: 'development' }, true)).toBe('not_production');
    expect(telemetryOffReason({ ...on, env: 'test' }, true)).toBe('not_production');
    expect(telemetryOffReason({ ...on, optOut: 'env' }, true)).toBe('env_opt_out');
    expect(telemetryOffReason({ ...on, optOut: 'dnt' }, true)).toBe('do_not_track');
    expect(telemetryOffReason(on, false)).toBe('admin_disabled');
  });

  it('reads TELEMETRY and DO_NOT_TRACK', () => {
    expect(telemetryOptOut({})).toBeNull();
    expect(telemetryOptOut({ TELEMETRY: 'off' })).toBe('env');
    expect(telemetryOptOut({ TELEMETRY: 'FALSE' })).toBe('env');
    expect(telemetryOptOut({ TELEMETRY: 'on' })).toBeNull();
    expect(telemetryOptOut({ DO_NOT_TRACK: '1' })).toBe('dnt');
    expect(telemetryOptOut({ DO_NOT_TRACK: 'true' })).toBe('dnt');
    expect(telemetryOptOut({ DO_NOT_TRACK: '0' })).toBeNull();
  });
});

describe('feature events', () => {
  const by = { kind: 'account' as const, id: 'acc-1' };
  const connection = {
    id: 'c1',
    mapId: 'm1',
    source: 31000001,
    target: 31000002,
    type: 'wormhole',
    timeStatus: 'normal',
    massStatus: 'fresh',
    shipSize: 'large',
    massSaved: false,
    dangerous: false,
    bubbled: 'none',
    eolAt: null,
    createdAt: 1,
    updatedAt: 1,
  };

  it('say which feature was used, never on what', () => {
    const added = featureEvents({ type: 'system.added', actor: by, data: { solarSystemId: 31000001 } }, {});
    expect(added).toEqual([{ event: 'system_added', props: { source: 'manual' }, accountId: 'acc-1' }]);
    expect(JSON.stringify(added)).not.toContain('31000001');
  });

  it('tell auto-mapping from people', () => {
    expect(changeSource({ channel: { kind: 'system', id: 'auto-mapping' } })).toBe('auto');
    expect(changeSource({ channel: { kind: 'web' } })).toBe('manual');
    expect(changeSource({ channel: { kind: 'system', id: 'demo' } })).toBeNull();
    expect(
      featureEvents(
        { type: 'system.added', actor: by, data: {} },
        { channel: { kind: 'system', id: 'demo' } },
      ),
    ).toEqual([]);
  });

  it('name the connection fields that changed', () => {
    const after = { ...connection, timeStatus: 'eol', massStatus: 'critical' };
    expect(
      featureEvents({ type: 'connection.updated', actor: by, data: after, before: connection }, {}).map(
        (e) => e.props.field,
      ),
    ).toEqual(['eol', 'mass']);
  });

  it('count an import by kind and size, never by where it came from', () => {
    const channel = { kind: 'system' as const, id: 'wanderer:wanderer.example.org/secret-chain' };
    const outcome = {
      systems: { created: 28, updated: 2, unchanged: 0, skipped: 0, removed: 0 },
      connections: { created: 27, updated: 0, unchanged: 1, skipped: 0, removed: 0 },
      signatures: { created: 0, updated: 0, unchanged: 48, skipped: 0, removed: 0 },
      access: { created: 6, updated: 0, unchanged: 0, skipped: 0, removed: 0 },
    };
    const source = {
      kind: 'wanderer-api',
      host: 'wanderer.example.org',
      slug: 'secret-chain',
      name: 'Secret',
    };
    const events = featureEvents(
      {
        type: 'import.finished',
        actor: by,
        data: { jobId: 'j', source, status: 'done', outcome, error: null },
      },
      { channel },
    );
    expect(events).toEqual([
      {
        event: 'import_completed',
        props: {
          source: 'api',
          status: 'done',
          systems: countBucket(30),
          connections: countBucket(27),
          signatures: countBucket(0),
          access_rules: countBucket(6),
        },
        accountId: 'acc-1',
      },
    ]);
    expect(validateTelemetryEvent('import_completed', events[0]!.props).ok).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/secret|example/i);
    // What the import wrote is not counted as people's edits.
    expect(featureEvents({ type: 'system.added', actor: by, data: {} }, { channel })).toEqual([]);
  });

  it('count passages by how they were recorded, never which ship or pilot', () => {
    const tracked = featureEvents(
      {
        type: 'connection.passage',
        actor: { kind: 'system', id: 'mapping' },
        data: { connectionId: 'c1', characterId: 90000001, shipTypeId: 641, mass: 98_400_000 },
      },
      {},
    );
    expect(tracked).toEqual([
      { event: 'passage_logged', props: { source: 'tracked', mode: 'cold' }, accountId: null },
    ]);
    const manual = featureEvents(
      {
        type: 'connection.passage',
        actor: by,
        data: { connectionId: 'c1', characterId: null, shipTypeId: 28606, source: 'manual', massMode: 'hot' },
      },
      { channel: { kind: 'web' } },
    );
    expect(manual[0]?.props).toEqual({ source: 'manual', mode: 'hot' });
    expect(JSON.stringify([...tracked, ...manual])).not.toMatch(/641|28606|90000001/);
    for (const e of [...tracked, ...manual]) expect(validateTelemetryEvent(e.event, e.props).ok).toBe(true);
  });

  it('count a revert as one history revert', () => {
    expect(featureEvents({ type: 'system.added', actor: by, data: {} }, { revertOf: 'e1' })).toEqual([
      { event: 'history_reverted', props: {}, accountId: 'acc-1' },
    ]);
  });

  it('count plugins an admin enabled, by first-party id only', () => {
    const plugin = (id: string, enabled: boolean) => ({ id, enabled, name: 'Secret plugin' });
    expect(
      featureEvents(
        { type: 'plugin.updated', actor: by, data: plugin('x', true), before: plugin('x', false) },
        {},
      ),
    ).toEqual([{ event: 'plugin_enabled', props: { plugin: 'third_party' }, accountId: 'acc-1' }]);
    expect(
      featureEvents(
        { type: 'plugin.updated', actor: { kind: 'system', id: 'bundled-plugins' }, data: plugin('x', true) },
        {},
      ),
    ).toEqual([]);
  });
});

describe('request features', () => {
  it('read routes by their pattern and enum inputs', () => {
    expect(OBSERVED_ROUTES.has('GET /api/maps/:mapId/route')).toBe(true);
    expect(
      requestFeature({
        method: 'GET',
        path: '/api/maps/:mapId/route',
        query: { from: '30000142', to: '31000005', mode: 'outlaw', skip: 'eol' },
        body: undefined,
        response: {},
      }),
    ).toEqual({ event: 'route_computed', props: { mode: 'outlaw', skips: true, avoids: false } });
    expect(
      requestFeature({
        method: 'POST',
        path: '/api/maps/:mapId/systems/:solarSystemId/signatures/paste',
        query: {},
        body: { text: 'ABC-123 Cosmic Signature' },
        response: { added: 7, updated: 0, removed: 1, skipped: ['x'] },
      }),
    ).toEqual({ event: 'signatures_pasted', props: { added: '6-10', updated: '0', removed: '1' } });
    expect(
      requestFeature({
        method: 'POST',
        path: '/api/maps/:mapId/connections/:connectionId/roll-plan',
        query: {},
        body: { ships: [{ shipTypeId: 641 }] },
        response: { result: 'risky', reason: 'strand', steps: [] },
      }),
    ).toEqual({ event: 'roll_planned', props: { result: 'risky' } });
    expect(validateTelemetryEvent('roll_planned', { result: 'ok' }).ok).toBe(true);
    expect(validateTelemetryEvent('roll_planned', { result: 'J123456' }).ok).toBe(false);
    expect(
      requestFeature({ method: 'GET', path: '/api/maps', query: {}, body: undefined, response: [] }),
    ).toBeNull();
  });

  it('count planned jump routes by hull and legs, never by system', () => {
    const feature = requestFeature({
      method: 'POST',
      path: '/api/jumps/plan',
      query: {},
      body: { shipTypeId: 28850, origin: 30002813, destination: 30003504 },
      response: { ship: { hull: 'jump_freighter', name: 'Ark' }, route: { legs: [{}, {}, {}] } },
    });
    expect(feature).toEqual({ event: 'jump_planned', props: { hull: 'jump_freighter', legs: '2-5' } });
    expect(validateTelemetryEvent(feature!.event, feature!.props)).toEqual({
      ok: true,
      props: feature!.props,
    });
    expect(
      requestFeature({
        method: 'POST',
        path: '/api/jumps/plan',
        query: {},
        body: {},
        response: { ship: { hull: 'titan' }, route: null },
      }),
    ).toEqual({ event: 'jump_planned', props: { hull: 'titan', legs: '0' } });
  });
});
