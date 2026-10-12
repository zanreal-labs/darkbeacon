import { describe, expect, it } from 'vitest';
import type { Actor } from '@darkbeacon/core';
import { HeartbeatProps } from '../domain/catalogue.js';
import { PRODUCTION, SAMPLE_METRICS, service } from './fakes.test-support.js';

const admin: Actor = { kind: 'account', id: 'admin-1', instanceRole: 'admin' };
const user: Actor = { kind: 'account', id: 'user-1', instanceRole: 'user' };
const web = (event: string, props: Record<string, unknown>) => ({ events: [{ event, props }] });

describe('TelemetryService', () => {
  it('sends catalogued events with pseudonymous ids and fixed anonymous properties', async () => {
    const { telemetry, sink } = await service();
    expect(telemetry.track('map_created', {}, 'user-1')).toBe(true);
    const [sent] = sink.captured;
    expect(sent).toMatchObject({ event: 'map_created' });
    expect(sent!.distinctId).toMatch(/^u_[0-9a-f]{32}$/);
    expect(sent!.distinctId).not.toContain('user-1');
    expect(sent!.properties).toEqual({
      instance_id: '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11',
      app_version: '0.1.0',
      demo: false,
      origin: 'server',
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
    });
  });

  it('drops events that are not on the allow-list', async () => {
    const rejected: string[] = [];
    const { telemetry, sink } = await service({ onRejected: (p) => rejected.push(p) });
    expect(telemetry.track('character_jumped', { system: 'Jita' })).toBe(false);
    expect(telemetry.track('system_added', { source: 'manual', name: 'Home' })).toBe(false);
    expect(sink.captured).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  describe('sends nothing when', () => {
    it.each([
      ['the build has no key', { ...PRODUCTION, environment: { ...PRODUCTION.environment, key: '' } }],
      [
        'TELEMETRY=off',
        { ...PRODUCTION, environment: { ...PRODUCTION.environment, optOut: 'env' as const } },
      ],
      [
        'DO_NOT_TRACK=1',
        { ...PRODUCTION, environment: { ...PRODUCTION.environment, optOut: 'dnt' as const } },
      ],
      [
        'it is not production',
        { ...PRODUCTION, environment: { ...PRODUCTION.environment, env: 'test' as const } },
      ],
    ])('%s', async (_, config) => {
      const { telemetry, sink } = await service({ config });
      telemetry.track('map_created', {}, 'user-1');
      telemetry.observe({ type: 'system.added', actor: { kind: 'account', id: 'u' }, data: {} }, {});
      expect(telemetry.ingest(user, web('panel_opened', { panel: 'local' }))).toEqual({ accepted: 0 });
      expect(await telemetry.heartbeatIfDue(0)).toBe(false);
      expect(sink.captured).toEqual([]);
      expect(telemetry.active).toBe(false);
    });

    it('an admin turned it off, which is recorded on the audit trail', async () => {
      const { telemetry, sink, log, state } = await service();
      const status = await telemetry.setEnabled(admin, false);
      expect(status).toMatchObject({ active: false, reason: 'admin_disabled', adminEnabled: false });
      expect(state.enabled).toBe(false);
      expect(log.appended).toMatchObject([
        {
          stream: 'audit:instance',
          type: 'telemetry.changed',
          data: { enabled: false },
          before: { enabled: true },
        },
      ]);
      telemetry.track('map_created', {});
      expect(await telemetry.heartbeatIfDue(0)).toBe(false);
      expect(sink.captured).toEqual([]);
    });
  });

  it('keeps the admin switch across restarts', async () => {
    const first = await service();
    await first.telemetry.setEnabled(admin, false);
    const again = await service({ state: first.state });
    expect(again.telemetry.offReason).toBe('admin_disabled');
  });

  it('lets only admins change or read the status', async () => {
    const { telemetry } = await service();
    await expect(telemetry.setEnabled(user, false)).rejects.toThrow();
    await expect(telemetry.status(user)).rejects.toThrow();
    await expect(telemetry.status(null)).rejects.toThrow();
  });

  it('caps events per minute', async () => {
    const { telemetry, sink, clock } = await service({ perMinute: 3 });
    for (let i = 0; i < 5; i++) telemetry.track('ping_created', {});
    expect(sink.captured).toHaveLength(3);
    expect((await telemetry.status(admin)).dropped).toBe(2);
    clock.time += 60_000;
    expect(telemetry.track('ping_created', {})).toBe(true);
  });

  describe('web ingestion', () => {
    it('forwards catalogued web events as the signed-in account', async () => {
      const { telemetry, sink } = await service();
      expect(telemetry.ingest(user, web('shortcut_used', { shortcut: 'fit_chain' }))).toEqual({
        accepted: 1,
      });
      expect(sink.captured[0]).toMatchObject({ event: 'shortcut_used', properties: { origin: 'web' } });
    });

    it('refuses the whole batch when one event is not on the list', async () => {
      const { telemetry, sink } = await service();
      const batch = {
        events: [
          { event: 'panel_opened', props: { panel: 'local' } },
          { event: 'panel_opened', props: { panel: 'local', character: 'Some Pilot' } },
        ],
      };
      expect(() => telemetry.ingest(user, batch)).toThrow(/panel_opened/);
      expect(() => telemetry.ingest(user, web('map_created', {}))).toThrow(/unknown event/);
      expect(sink.captured).toEqual([]);
    });

    it('needs an account', async () => {
      const { telemetry } = await service();
      expect(() => telemetry.ingest(null, web('panel_opened', { panel: 'local' }))).toThrow();
    });
  });

  describe('the heartbeat', () => {
    it('is sent once a day from the instance id', async () => {
      const { telemetry, sink, clock, state } = await service();
      expect(await telemetry.heartbeatIfDue(86_400_000)).toBe(true);
      expect(await telemetry.heartbeatIfDue(86_400_000)).toBe(false);
      clock.time += 86_400_000;
      expect(await telemetry.heartbeatIfDue(86_400_000)).toBe(true);
      expect(sink.captured).toHaveLength(2);
      expect(state.last).toBe(clock.time);
      const [heartbeat] = sink.captured;
      expect(heartbeat!.distinctId).toBe('0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11');
      const {
        instance_id,
        app_version,
        demo,
        origin,
        $process_person_profile,
        $geoip_disable,
        $ip,
        ...props
      } = heartbeat!.properties;
      expect({
        instance_id,
        app_version,
        demo,
        origin,
        $process_person_profile,
        $geoip_disable,
        $ip,
      }).toBeTruthy();
      expect(HeartbeatProps.safeParse(props).success).toBe(true);
      expect(props).toEqual({
        ...SAMPLE_METRICS,
        node_major: 24,
        discord_login: false,
        eve_sso: true,
        online_peak: 5,
      });
    });

    it('reports the peak of tracked characters online since the last one', async () => {
      const { telemetry, sink, metrics } = await service();
      metrics.online = 9;
      await telemetry.sampleOnline();
      metrics.online = 2;
      await telemetry.heartbeatIfDue(0);
      expect(sink.captured[0]!.properties.online_peak).toBe(9);
    });

    it('is previewed on the admin card with the last payloads', async () => {
      const { telemetry } = await service();
      telemetry.track('ping_created', {});
      telemetry.track('labels_changed', {});
      const status = await telemetry.status(admin);
      expect(status.recent.map((p) => p.event)).toEqual(['labels_changed', 'ping_created']);
      expect(status.heartbeatPreview.event).toBe('instance_heartbeat');
      expect(status).toMatchObject({ active: true, reason: null, keyConfigured: true });
    });
  });

  it('counts a revert once, however many events it writes', async () => {
    const { telemetry, sink } = await service();
    const actor = { kind: 'account' as const, id: 'u' };
    telemetry.observe({ type: 'system.added', actor, data: {} }, { revertOf: 'e1' });
    telemetry.observe({ type: 'connection.added', actor, data: { type: 'wormhole' } }, { revertOf: 'e1' });
    telemetry.observe({ type: 'connection.added', actor, data: { type: 'wormhole' } }, {});
    expect(sink.captured.map((e) => e.event)).toEqual(['history_reverted', 'connection_added']);
  });

  it('shows the notice to admins until they dismiss it', async () => {
    const { telemetry } = await service();
    expect(await telemetry.client(user)).toEqual({ active: true, notice: false });
    expect(await telemetry.client(admin)).toEqual({ active: true, notice: true });
    await telemetry.dismissNotice(admin);
    expect(await telemetry.client(admin)).toEqual({ active: true, notice: false });
  });
});
