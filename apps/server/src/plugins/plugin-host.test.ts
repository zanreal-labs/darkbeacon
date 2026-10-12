import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualClock, newEvent, type Actor, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { NotifierRegistry } from '@darkbeacon/notifications';
import type { PluginLogger } from '@darkbeacon/plugin-sdk';
import { PluginAdmin, newInstalledPlugin, type InstalledPlugin } from '@darkbeacon/plugins';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import {
  KyselyPluginRepository,
  KyselyThemeRepository,
  type PluginTables,
} from '../adapters/plugins/kysely-plugin-repository.js';
import { FilePluginInstaller, summarize } from './installer.js';
import {
  fixtureLogs,
  fixtureMigration,
  fixtureServer,
  pluginManifest,
  tempDir,
  writeFiles,
} from './packages.test-support.js';
import { SecretBox } from '../adapters/identity/secret-box.js';
import { EventConsumers } from '../platform/event-consumers.js';
import { PluginCommandRegistry } from './plugin-commands.js';
import { PluginHost, PluginPortProviders } from './plugin-host.js';
import { FilePluginSettingsSchemas } from './settings-schemas.js';
import { PluginManifestSchema } from '@darkbeacon/plugin-sdk';

const admin: Actor = { kind: 'account', id: 'boss', instanceRole: 'admin' };
const quiet: PluginLogger = { debug() {}, info() {}, warn() {}, error() {} };

describeEachDialect('PluginHost', (t) => {
  let dir: string;
  let clock: ManualClock;
  let bus: InProcessEventBus;
  let log: KyselyEventLog;
  let plugins: KyselyPluginRepository;
  let notifiers: NotifierRegistry;
  let commands: PluginCommandRegistry;
  let uc: PluginAdmin;
  let host: PluginHost;
  let consumers: EventConsumers;

  beforeEach(() => {
    delete (globalThis as { __dbkPlugins?: unknown }).__dbkPlugins;
    dir = tempDir('dbk-host-');
    clock = new ManualClock();
    bus = new InProcessEventBus(() => undefined);
    log = new KyselyEventLog(t.db, bus);
    consumers = new EventConsumers(t.db, log, bus, clock);
    plugins = new KyselyPluginRepository(t.db);
    notifiers = new NotifierRegistry();
    commands = new PluginCommandRegistry();
    const installer = new FilePluginInstaller({ pluginsDir: dir });
    const schemas = new FilePluginSettingsSchemas((id) => installer.pluginDir(id));
    uc = new PluginAdmin({
      plugins,
      themes: new KyselyThemeRepository(t.db),
      installer,
      schemas,
      uow: t.db,
      log,
      clock,
    });
    host = new PluginHost({
      admin: uc,
      plugins,
      schemas,
      database: t.db,
      // Alice views m1; nobody else sees anything.
      access: {
        roleOf: async (actor, mapId) => (actor.id === 'alice' && mapId === 'm1' ? 'viewer' : null),
        mapsFor: async () => [],
      },
      bus,
      log,
      clock,
      notifiers,
      commands,
      providers: new PluginPortProviders(),
      pluginDir: (id) => installer.pluginDir(id),
      logger: () => quiet,
      failureThreshold: 3,
      consumers,
      publicUrl: 'https://beacon.example',
      secrets: (id) => new SecretBox('s'.repeat(32), `plugin:${id}`),
    });
  });

  beforeEach(async () => {
    await consumers.onApplicationBootstrap();
  });

  afterEach(async () => {
    await host.stop();
    await consumers.onModuleDestroy();
  });

  /** Puts a plugin on disk and in the registry, enabled unless said otherwise. */
  async function put(
    id: string,
    manifest: Record<string, unknown> = {},
    options: { enabled?: boolean; files?: Record<string, string>; marker?: number } = {},
  ): Promise<InstalledPlugin> {
    const full = pluginManifest(id, { events: ['system.*'], ...manifest });
    writeFiles(join(dir, id), {
      'darkbeacon-plugin.json': full,
      'server.js': fixtureServer(options.marker),
      ...options.files,
    });
    const plugin = {
      ...newInstalledPlugin(summarize(PluginManifestSchema.parse(full)), clock.now()),
      enabled: options.enabled ?? true,
    };
    await plugins.save(plugin);
    return plugin;
  }

  const emit = (type: string, mapId: string, data: object = {}) =>
    log.append([
      newEvent({ stream: `map:${mapId}`, type, actor: { kind: 'system', id: 't' }, data, occurredAt: 1 }),
    ]);

  it('loads enabled plugins and hands them only the ports they declare', async () => {
    await put('fx', { ports: ['clock', 'events'] });
    await put('off', {}, { enabled: false });
    await host.start();
    expect(host.isLoaded('fx')).toBe(true);
    expect(host.isLoaded('off')).toBe(false);
    expect(fixtureLogs().fx).toMatchObject({ registered: 1, ports: ['clock', 'events'], instance: 0 });
    expect(fixtureLogs().off).toBeUndefined();
  });

  it('gives plugins durable consumers, the public URL and their own secrets', async () => {
    (globalThis as { __dbkPlugins?: Record<string, unknown> }).__dbkPlugins = { fx: { durable: [] } };
    await put('fx');
    await host.start();
    const state = (
      globalThis as unknown as {
        __dbkPlugins: Record<string, { durable: string[]; publicUrl: string; sealed: boolean }>;
      }
    ).__dbkPlugins.fx!;
    expect(state).toMatchObject({ publicUrl: 'https://beacon.example', sealed: true });
    await vi.waitFor(async () => {
      await emit('system.added', 'm1');
      await consumers.wake();
      expect(state.durable).toContain('system.added@map:m1');
    });
    // Stopped with the plugin: events after the unload are not handled by it.
    await host.stop();
    const before = state.durable.length;
    await emit('system.added', 'm1');
    await consumers.wake();
    expect(state.durable).toHaveLength(before);
  });

  it('refuses event subscriptions the manifest does not declare', async () => {
    await put('fx');
    fixtureLogs().fx = { events: [], notified: [], registered: 0, disposed: 0 } as never;
    fixtureLogs().fx!.subscribeTo = 'connection.added';
    await host.start();
    expect(host.isLoaded('fx')).toBe(false);
    expect(await plugins.findById('fx')).toMatchObject({
      enabled: false,
      error: expect.stringMatching(/Failed to start: "connection.added" is not among the events/),
    });
  });

  it('delivers events only from maps the plugin is enabled on', async () => {
    await put('fx');
    await host.start();
    await emit('system.added', 'm1');
    await emit('connection.added', 'm1');
    await vi.waitFor(() => expect(fixtureLogs().fx!.events).toEqual(['system.added@map:m1']));

    await uc.setEnabled(admin, 'fx', false, 'm2');
    await host.sync('fx');
    await emit('system.updated', 'm2');
    await emit('system.removed', 'm1');
    await vi.waitFor(() => expect(fixtureLogs().fx!.events).toHaveLength(2));
    expect(fixtureLogs().fx!.events[1]).toBe('system.removed@map:m1');
    // A per-map switch applies without reloading.
    expect(fixtureLogs().fx!.registered).toBe(1);
  });

  it('disables a plugin that keeps failing, with the reason', async () => {
    await put('fx');
    await host.start();
    await emit('system.added', 'm1', { fail: true });
    await emit('system.added', 'm1', { fail: true });
    await emit('system.added', 'm1');
    await emit('system.added', 'm1', { fail: true });
    await vi.waitFor(() => expect(fixtureLogs().fx!.events).toHaveLength(1));
    // A success resets the count, so two failures in a row are not enough yet.
    expect(host.isLoaded('fx')).toBe(true);

    await emit('system.added', 'm1', { fail: true });
    await emit('system.added', 'm1', { fail: true });
    await vi.waitFor(async () => expect((await plugins.findById('fx'))?.enabled).toBe(false));
    expect(host.isLoaded('fx')).toBe(false);
    expect(fixtureLogs().fx!.disposed).toBe(1);
    const plugin = await plugins.findById('fx');
    expect(plugin).toMatchObject({ failureCount: 3, error: expect.stringContaining('3 failures in a row') });
    expect(plugin?.error).toContain('handler broke');
    const last = (await log.readSince('instance', 0)).at(-1) as DomainEvent<{ error: string }>;
    expect(last).toMatchObject({ type: 'plugin.updated', data: { enabled: false } });
  });

  it('disables a plugin whose register() throws', async () => {
    await put('fx');
    fixtureLogs().fx = { events: [], notified: [], registered: 0, disposed: 0, failRegister: true } as never;
    await host.start();
    expect(host.isLoaded('fx')).toBe(false);
    expect((await plugins.findById('fx'))?.error).toBe('Failed to start: cannot start');
  });

  it('routes HTTP requests to the plugin and contains route errors', async () => {
    await put('fx');
    await host.start();
    const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
    const request = { query: { q: '1' }, body: null };
    expect(await host.handleHttp('fx', 'GET', '/hello/bob%20b', alice, request)).toEqual({
      body: { hello: 'bob b', account: 'alice', q: '1' },
    });
    expect(await host.handleHttp('fx', 'GET', '/hello/bob', null, request)).toMatchObject({
      body: { account: null },
    });
    expect(await host.handleHttp('fx', 'GET', '/nope', alice, request)).toBeNull();
    expect(await host.handleHttp('fx', 'POST', '/hello/bob', alice, request)).toBeNull();
    expect(await host.handleHttp('other', 'GET', '/hello/bob', alice, request)).toBeNull();
    expect(await host.handleHttp('fx', 'POST', '/boom', alice, request)).toMatchObject({ status: 500 });
  });

  it('gives map routes the role of the caller and hides them on maps the plugin is off on', async () => {
    await put('fx');
    await host.start();
    const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
    const request = { query: {}, body: null };
    expect(await host.handleHttp('fx', 'GET', '/maps/m1', alice, request)).toEqual({
      body: { role: 'viewer' },
    });
    expect(await host.handleHttp('fx', 'GET', '/maps/m2', alice, request)).toEqual({ body: { role: null } });
    expect(await host.handleHttp('fx', 'GET', '/maps/m1', null, request)).toEqual({ body: { role: null } });
    await uc.setEnabled(admin, 'fx', false, 'm1');
    await host.sync('fx');
    expect(await host.handleHttp('fx', 'GET', '/maps/m1', alice, request)).toBeNull();
  });

  it('runs plugin migrations once and lets the plugin use its tables', async () => {
    await put(
      'fx',
      { ports: ['db'], migrations: 'migrations' },
      { files: { 'migrations/0001_items.js': fixtureMigration } },
    );
    await host.start();
    expect(fixtureLogs().fx).toMatchObject({ rows: 1 });

    // Reload (new revision): the migration is not applied again, the data stays.
    clock.advance(1);
    await plugins.save({ ...(await plugins.findById('fx'))!, installedAt: clock.now() });
    await host.sync('fx');
    expect(fixtureLogs().fx).toMatchObject({ rows: 2, registered: 2 });
    const applied = await t.db.db<PluginTables>().selectFrom('plugin_migration').selectAll().execute();
    expect(applied.map((m) => m.name)).toEqual(['fx/0001_items.js']);
  });

  it('reloads the new code when a new version is installed', async () => {
    await put('fx');
    await host.start();
    expect(fixtureLogs().fx).toMatchObject({ marker: 1, version: '1.0.0' });

    clock.advance(1);
    writeFileSync(join(dir, 'fx', 'server.js'), fixtureServer(2));
    writeFiles(join(dir, 'fx'), {
      'darkbeacon-plugin.json': pluginManifest('fx', { version: '1.1.0', events: ['system.*'] }),
    });
    const current = (await plugins.findById('fx'))!;
    await plugins.save({
      ...current,
      manifest: { ...current.manifest, version: '1.1.0' },
      installedAt: clock.now(),
    });
    await host.sync('fx');
    expect(fixtureLogs().fx).toMatchObject({ marker: 2, version: '1.1.0', registered: 2, disposed: 1 });

    await uc.setEnabled(admin, 'fx', false);
    await host.sync('fx');
    expect(host.isLoaded('fx')).toBe(false);
    expect(fixtureLogs().fx!.disposed).toBe(2);
  });

  it('adds provided notifiers to the core notifier, per map', async () => {
    await put('fx');
    await host.start();
    await notifiers.send({ mapId: null, title: 'instance', body: '' });
    await uc.setEnabled(admin, 'fx', false, 'm2');
    await host.sync('fx');
    await notifiers.send({ mapId: 'm2', title: 'hidden', body: '' });
    await notifiers.send({ mapId: 'm1', title: 'shown', body: '' });
    expect(fixtureLogs().fx!.notified).toEqual(['instance', 'shown']);
    expect(notifiers.ids()).toEqual(['fx:memo']);
    await host.stop();
    expect(notifiers.ids()).toEqual([]);
  });

  it('runs core commands as the plugin actor', async () => {
    const calls: Array<{ actor: Actor; input: unknown }> = [];
    commands.register('echo', async (actor, input) => {
      calls.push({ actor, input });
      return input;
    });
    expect(await commands.run({ kind: 'plugin', id: 'fx' }, 'echo', { a: 1 })).toEqual({ a: 1 });
    expect(calls[0]?.actor).toEqual({ kind: 'plugin', id: 'fx' });
    expect(() => commands.run({ kind: 'plugin', id: 'fx' }, 'nope', null)).toThrow(
      'Command "nope" not found',
    );
  });
});
