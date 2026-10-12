import { expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { newInstalledPlugin, type InstalledTheme } from '@darkbeacon/plugins';
import { KyselyPluginRepository, KyselyThemeRepository } from './kysely-plugin-repository.js';

const manifest = {
  id: 'fx',
  name: 'Fx',
  version: '1.0.0',
  description: 'Does things',
  server: 'dist/server.js',
  web: 'dist/web.js',
  settings: null,
  migrations: null,
  ports: ['maps'],
  events: ['system.*'],
};

describeEachDialect('KyselyPluginRepository', (t) => {
  it('saves, replaces, lists and deletes plugins', async () => {
    const repo = new KyselyPluginRepository(t.db);
    const plugin = newInstalledPlugin(manifest, Date.UTC(2026, 9, 11));
    await repo.save(plugin);
    expect(await repo.findById('fx')).toEqual(plugin);

    const changed = {
      ...plugin,
      enabled: true,
      disabledMapIds: ['m1'],
      failureCount: 2,
      error: 'boom',
      settings: { a: 1 },
      mapSettings: { m1: { a: 2 } },
    };
    await repo.save(changed);
    expect(await repo.list()).toEqual([changed]);

    await repo.delete('fx');
    expect(await repo.findById('fx')).toBeNull();
  });
});

describeEachDialect('KyselyThemeRepository', (t) => {
  it('stores themes and choices per scope', async () => {
    const repo = new KyselyThemeRepository(t.db);
    const theme: InstalledTheme = {
      id: 'amarr',
      name: 'Amarr',
      version: '1.0.0',
      colorScheme: 'dark',
      extends: 'dark',
      tokens: { 'color-accent': '#d4a017' },
      installedAt: 5,
    };
    await repo.save(theme);
    await repo.save({ ...theme, version: '1.0.1' });
    expect(await repo.list()).toEqual([{ ...theme, version: '1.0.1' }]);

    await repo.setChoice('instance', 'amarr');
    await repo.setChoice('account:a', 'dark');
    await repo.setChoice('account:a', 'amarr');
    expect(await repo.getChoice('account:a')).toBe('amarr');
    await repo.setChoice('account:b', 'dark');
    await repo.clearChoicesOf('amarr');
    expect(await repo.getChoice('instance')).toBeNull();
    expect(await repo.getChoice('account:a')).toBeNull();
    expect(await repo.getChoice('account:b')).toBe('dark');
    await repo.setChoice('account:b', null);
    expect(await repo.getChoice('account:b')).toBeNull();

    await repo.delete('amarr');
    expect(await repo.findById('amarr')).toBeNull();
  });
});
