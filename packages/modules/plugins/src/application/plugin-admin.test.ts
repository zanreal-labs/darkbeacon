import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, type Actor } from '@darkbeacon/core';
import type { PluginManifestSummary } from '../domain/plugin.js';
import { parsePackageSource } from '../domain/source.js';
import { PluginAdmin } from './plugin-admin.js';
import {
  FakeInstaller,
  FakeSchemas,
  MemoryLog,
  MemoryPlugins,
  MemoryThemes,
  directUow,
} from './fakes.test-support.js';

const admin: Actor = { kind: 'account', id: 'boss', instanceRole: 'admin' };
const user: Actor = { kind: 'account', id: 'pleb', instanceRole: 'user' };

const manifest = (version = '1.0.0', extra: Partial<PluginManifestSummary> = {}): PluginManifestSummary => ({
  id: 'pinger',
  name: 'Pinger',
  version,
  description: null,
  server: 'dist/server.js',
  web: null,
  settings: 'settings.schema.json',
  migrations: null,
  ports: ['notifier'],
  events: ['ping.*'],
  ...extra,
});

describe('PluginAdmin', () => {
  let plugins: MemoryPlugins;
  let installer: FakeInstaller;
  let log: MemoryLog;
  let clock: ManualClock;
  let uc: PluginAdmin;

  beforeEach(() => {
    plugins = new MemoryPlugins();
    installer = new FakeInstaller();
    log = new MemoryLog();
    clock = new ManualClock();
    uc = new PluginAdmin({
      plugins,
      themes: new MemoryThemes(),
      installer,
      schemas: new FakeSchemas(),
      uow: directUow,
      log,
      clock,
    });
  });

  const install = (version = '1.0.0') => {
    installer.next = { kind: 'plugin', manifest: manifest(version), directory: `/staging/${version}` };
    return uc.install(admin, { kind: 'catalog', name: 'pinger' });
  };

  it('installs bundled plugins switched on, upgrades them, and never brings back an uninstalled one', async () => {
    const seen = new Set<string>();
    const marks = { seen: async (id: string) => seen.has(id), mark: async (id: string) => void seen.add(id) };
    const ship = (version: string) => {
      installer.entries = [
        {
          source: 'catalog:pinger',
          kind: 'plugin',
          id: 'pinger',
          name: 'Pinger',
          version,
          description: null,
        },
      ];
      installer.next = { kind: 'plugin', manifest: manifest(version), directory: `/staging/${version}` };
    };
    ship('1.0.0');
    expect(await uc.ensureBundled(['pinger', 'missing'], marks)).toEqual(['pinger']);
    expect(plugins.rows.get('pinger')).toMatchObject({ enabled: true });
    // The same version again: nothing to do.
    expect(await uc.ensureBundled(['pinger'], marks)).toEqual([]);
    // A newer version shipped: upgraded, still on (an admin who switched it off keeps it off).
    await uc.setEnabled(admin, 'pinger', false);
    ship('1.1.0');
    expect(await uc.ensureBundled(['pinger'], marks)).toEqual(['pinger']);
    expect(plugins.rows.get('pinger')).toMatchObject({ enabled: false, manifest: { version: '1.1.0' } });
    // Uninstalled by an admin: stays away.
    await uc.uninstall(admin, 'pinger');
    expect(await uc.ensureBundled(['pinger'], marks)).toEqual([]);
    expect(plugins.rows.has('pinger')).toBe(false);
  });

  it('installs disabled, commits the files and publishes plugin.updated', async () => {
    const dto = await install();
    expect(dto).toMatchObject({ id: 'pinger', enabled: false, ports: ['notifier'], hasSettings: true });
    expect(installer.committed).toEqual(['/staging/1.0.0']);
    expect(log.events).toEqual([
      expect.objectContaining({
        stream: 'instance',
        type: 'plugin.updated',
        actor: { kind: 'account', id: 'boss' },
      }),
    ]);
  });

  it('keeps enablement and settings on upgrade and clears the failure record', async () => {
    await install();
    await uc.setEnabled(admin, 'pinger', true);
    await uc.updateSettings(admin, 'pinger', { url: 'x' });
    clock.advance(1000);

    expect(await install('1.1.0')).toMatchObject({ version: '1.1.0', enabled: true, error: null });
    expect(plugins.rows.get('pinger')).toMatchObject({
      settings: { url: 'x', username: 'Darkbeacon' },
      installedAt: clock.now(),
    });

    await uc.disableFailing('pinger', 'boom', 5);
    expect(await install('1.1.1')).toMatchObject({ enabled: false, error: null });
    expect(plugins.rows.get('pinger')?.failureCount).toBe(0);
  });

  it('only lets instance admins manage plugins', async () => {
    installer.next = { kind: 'plugin', manifest: manifest(), directory: '/s' };
    await expect(uc.install(user, { kind: 'catalog', name: 'pinger' })).rejects.toThrow('not allowed');
    await expect(uc.install(null, { kind: 'catalog', name: 'pinger' })).rejects.toThrow('Sign in');
    await expect(uc.list(user)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a theme package and discards it', async () => {
    installer.next = {
      kind: 'theme',
      directory: '/staging/theme',
      theme: { id: 't', name: 'T', version: '1.0.0', colorScheme: 'dark', extends: 'dark', tokens: {} },
    };
    await expect(uc.install(admin, { kind: 'catalog', name: 't' })).rejects.toMatchObject({
      code: 'validation',
    });
    expect(installer.discarded).toEqual(['/staging/theme']);
    expect(plugins.rows.size).toBe(0);
  });

  it('switches plugins per map without touching the instance switch', async () => {
    await install();
    await uc.setEnabled(admin, 'pinger', true);
    expect(await uc.setEnabled(admin, 'pinger', false, 'map-1')).toMatchObject({
      enabled: true,
      disabledMapIds: ['map-1'],
    });
    expect(await uc.setEnabled(admin, 'pinger', true, 'map-1')).toMatchObject({ disabledMapIds: [] });
  });

  it('disables a failing plugin with the reason, once', async () => {
    await install();
    await uc.setEnabled(admin, 'pinger', true);
    expect(await uc.disableFailing('pinger', 'Disabled after 5 failures', 5)).toMatchObject({
      enabled: false,
      error: 'Disabled after 5 failures',
    });
    expect(await uc.disableFailing('pinger', 'again', 6)).toBeNull();
    expect(log.events.at(-1)).toMatchObject({ actor: { kind: 'system', id: 'plugin-loader' } });
    // Enabling again clears the error.
    expect(await uc.setEnabled(admin, 'pinger', true)).toMatchObject({ enabled: true, error: null });
  });

  it('validates instance settings and stores map overrides separately', async () => {
    await install();
    await expect(uc.updateSettings(admin, 'pinger', { url: 5 })).rejects.toMatchObject({
      code: 'validation',
      details: [{ path: 'url', message: 'Expected string' }],
    });
    await uc.updateSettings(admin, 'pinger', { url: 'a' });
    const forMap = await uc.updateSettings(admin, 'pinger', { url: 'b' }, 'map-1');
    expect(forMap).toEqual({ schema: { type: 'object' }, values: { url: 'b' }, mapId: 'map-1' });
    expect(await uc.getSettings(admin, 'pinger')).toMatchObject({ values: { url: 'a' }, mapId: null });
  });

  it('forgets the switches and settings of a deleted map', async () => {
    await install();
    await uc.setEnabled(admin, 'pinger', false, 'map-1');
    await uc.setEnabled(admin, 'pinger', false, 'map-2');
    await uc.updateSettings(admin, 'pinger', { url: 'b' }, 'map-1');
    const published = log.events.length;
    await uc.forgetMap('map-1');
    expect(plugins.rows.get('pinger')).toMatchObject({ disabledMapIds: ['map-2'], mapSettings: {} });
    expect(log.events.slice(published)).toEqual([expect.objectContaining({ type: 'plugin.updated' })]);
    await uc.forgetMap('map-1');
    expect(log.events).toHaveLength(published + 1);
  });

  it('uninstalls: removes the row and the files and publishes plugin.removed', async () => {
    await install();
    await uc.uninstall(admin, 'pinger');
    expect(plugins.rows.size).toBe(0);
    expect(installer.removed).toEqual(['pinger']);
    expect(log.events.at(-1)).toMatchObject({ type: 'plugin.removed', data: { id: 'pinger' } });
    await expect(uc.uninstall(admin, 'pinger')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists enabled web plugins to any account', async () => {
    installer.next = { kind: 'plugin', manifest: manifest('1.0.0', { web: 'dist/web.js' }), directory: '/s' };
    await uc.install(admin, { kind: 'catalog', name: 'pinger' });
    expect(await uc.webPlugins(user)).toEqual([]);
    await uc.setEnabled(admin, 'pinger', true);
    expect((await uc.webPlugins(user)).map((p) => p.id)).toEqual(['pinger']);
    await expect(uc.webPlugins(null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('marks catalogue entries that are installed', async () => {
    installer.entries = [
      {
        source: 'catalog:pinger',
        kind: 'plugin',
        id: 'pinger',
        name: 'Pinger',
        version: '2.0.0',
        description: null,
      },
    ];
    expect(await uc.catalog(admin)).toMatchObject([{ installedVersion: null }]);
    await install();
    expect(await uc.catalog(admin)).toMatchObject([{ installedVersion: '1.0.0' }]);
  });
});

describe('parsePackageSource', () => {
  it('understands catalogue entries and npm specs', () => {
    expect(parsePackageSource('catalog:discord-notify')).toEqual({ kind: 'catalog', name: 'discord-notify' });
    expect(parsePackageSource('darkbeacon-plugin-x')).toEqual({
      kind: 'npm',
      name: 'darkbeacon-plugin-x',
      version: null,
    });
    expect(parsePackageSource('@acme/dbk-plugin@1.2.3')).toEqual({
      kind: 'npm',
      name: '@acme/dbk-plugin',
      version: '1.2.3',
    });
    expect(parsePackageSource('@acme/dbk-plugin@next')).toMatchObject({ version: 'next' });
  });

  it('rejects anything else', () => {
    for (const bad of ['catalog:../x', 'Has Space', 'https://evil.example/x.tgz', 'x@^1.0', '../x']) {
      expect(() => parsePackageSource(bad), bad).toThrow();
    }
  });
});
