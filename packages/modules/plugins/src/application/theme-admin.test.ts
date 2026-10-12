import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, type Actor } from '@wormwright/core';
import { ThemeAdmin } from './theme-admin.js';
import { FakeInstaller, MemoryThemes, directUow } from './fakes.test-support.js';

const admin: Actor = { kind: 'account', id: 'boss', instanceRole: 'owner' };
const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };

const amarr = {
  id: 'amarr',
  name: 'Amarr',
  version: '1.0.0',
  colorScheme: 'dark' as const,
  extends: 'dark',
  tokens: { 'color-accent': '#d4a017' },
};

describe('ThemeAdmin', () => {
  let themes: MemoryThemes;
  let installer: FakeInstaller;
  let uc: ThemeAdmin;

  beforeEach(() => {
    themes = new MemoryThemes();
    installer = new FakeInstaller();
    uc = new ThemeAdmin({
      themes,
      installer,
      uow: directUow,
      clock: new ManualClock(),
      builtInIds: ['system', 'default', 'dark', 'contrast'],
    });
  });

  const installAmarr = (theme = amarr) => {
    installer.next = { kind: 'theme', theme, directory: '/staging/amarr' };
    return uc.install(admin, { kind: 'catalog', name: 'theme-amarr' });
  };

  it('installs a theme package into the database and drops the files', async () => {
    expect(await installAmarr()).toMatchObject({ id: 'amarr', installedAt: Date.UTC(2026, 0, 1) });
    expect(installer.discarded).toEqual(['/staging/amarr']);
    expect(installer.committed).toEqual([]);
  });

  it('refuses built-in ids, unknown bases and plugin packages', async () => {
    await expect(installAmarr({ ...amarr, id: 'dark' })).rejects.toMatchObject({ code: 'validation' });
    await expect(installAmarr({ ...amarr, extends: 'neon' })).rejects.toMatchObject({ code: 'validation' });
    installer.next = {
      kind: 'plugin',
      directory: '/staging/p',
      manifest: {
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: null,
        server: 'x.js',
        web: null,
        settings: null,
        migrations: null,
        ports: [],
        events: [],
      },
    };
    await expect(uc.install(admin, { kind: 'catalog', name: 'p' })).rejects.toThrow('plugin');
    await expect(installAmarr()).resolves.toBeTruthy();
    await expect(uc.install(alice, { kind: 'catalog', name: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('keeps an instance default and a choice per account', async () => {
    await installAmarr();
    expect(await uc.overview(null)).toMatchObject({ defaultThemeId: 'system', selectedThemeId: null });

    await uc.setDefault(admin, 'amarr');
    expect(await uc.select(alice, 'contrast')).toMatchObject({
      defaultThemeId: 'amarr',
      selectedThemeId: 'contrast',
    });
    expect(await uc.overview(admin)).toMatchObject({ selectedThemeId: null });
    expect(await uc.select(alice, 'system')).toMatchObject({ selectedThemeId: 'system' });
    expect(await uc.select(alice, null)).toMatchObject({ selectedThemeId: null });

    await expect(uc.select(alice, 'neon')).rejects.toMatchObject({ code: 'not_found' });
    await expect(uc.setDefault(alice, 'dark')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(uc.select(null, 'dark')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('falls back to the default when the chosen theme is uninstalled', async () => {
    await installAmarr();
    await uc.setDefault(admin, 'amarr');
    await uc.select(alice, 'amarr');
    await uc.uninstall(admin, 'amarr');
    expect(await uc.overview(alice)).toMatchObject({
      installed: [],
      defaultThemeId: 'system',
      selectedThemeId: null,
    });
    await expect(uc.uninstall(admin, 'amarr')).rejects.toMatchObject({ code: 'not_found' });
  });
});
