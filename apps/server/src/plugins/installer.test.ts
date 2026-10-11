import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_DIR, FilePluginInstaller } from './installer.js';
import { packTgz, pluginManifest, tempDir, writeFiles } from './packages.test-support.js';

const theme = { id: 'sunset', name: 'Sunset', version: '1.0.0', colorScheme: 'light', tokens: {} };

describe('FilePluginInstaller', () => {
  let pluginsDir: string;
  let installer: FilePluginInstaller;

  beforeEach(() => {
    pluginsDir = tempDir('ww-plugins-');
    installer = new FilePluginInstaller({ pluginsDir, catalogDir: tempDir('ww-catalog-') });
  });

  const upload = async (files: Record<string, string | object>, prefix?: string) =>
    installer.stage({ kind: 'upload', data: await packTgz(writeFiles(tempDir(), files), prefix) });

  const staging = () => readdirSync(join(pluginsDir, '.staging'));

  it('stages an uploaded plugin, then commits and replaces it', async () => {
    const staged = await upload({
      'wormwright-plugin.json': pluginManifest('fx', { ports: ['clock'], events: ['system.*'] }),
      'server.js': 'export default { register() {} }',
    });
    expect(staged).toMatchObject({
      kind: 'plugin',
      manifest: { id: 'fx', version: '1.0.0', server: 'server.js', web: null, ports: ['clock'] },
    });
    await installer.commit(staged);
    expect(readFileSync(join(pluginsDir, 'fx', 'server.js'), 'utf8')).toContain('register');
    expect(staging()).toEqual([]);

    const v2 = await upload(
      {
        'wormwright-plugin.json': pluginManifest('fx', { version: '2.0.0' }),
        'server.js': 'export default { register() { return 2 } }',
      },
      '',
    );
    await installer.commit(v2);
    expect(readFileSync(join(pluginsDir, 'fx', 'server.js'), 'utf8')).toContain('return 2');
    expect(staging()).toEqual([]);

    await installer.remove('fx');
    expect(existsSync(join(pluginsDir, 'fx'))).toBe(false);
  });

  it('stages a theme package', async () => {
    expect(await upload({ 'wormwright-theme.json': theme })).toMatchObject({
      kind: 'theme',
      theme: { id: 'sunset', extends: 'default', colorScheme: 'light' },
    });
  });

  it('refuses broken packages and cleans up after them', async () => {
    await expect(upload({ 'wormwright-plugin.json': { id: 'Bad Id' } })).rejects.toMatchObject({
      code: 'validation',
      message: 'Invalid plugin manifest',
    });
    await expect(upload({ 'wormwright-plugin.json': pluginManifest('fx') })).rejects.toThrow(
      'names server.js, which is not in the package',
    );
    await expect(upload({ 'readme.md': 'hi' })).rejects.toThrow('has no wormwright-plugin.json');
    await expect(
      upload({ 'wormwright-plugin.json': pluginManifest('fx', { sdk: '^2.0' }), 'server.js': '' }),
    ).rejects.toMatchObject({ details: [expect.stringContaining('not compatible')] });
    await expect(
      installer.stage({ kind: 'upload', data: Buffer.from('not a tarball') }),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    expect(staging()).toEqual([]);
  });

  it('skips links inside packages', async () => {
    const dir = writeFiles(tempDir(), {
      'wormwright-plugin.json': pluginManifest('fx'),
      'server.js': 'export default { register() {} }',
    });
    symlinkSync('/etc/hostname', join(dir, 'leak'));
    const staged = await installer.stage({ kind: 'upload', data: await packTgz(dir) });
    expect(existsSync(join(staged.directory, 'leak'))).toBe(false);
    expect(existsSync(join(staged.directory, 'server.js'))).toBe(true);
  });

  describe('npm', () => {
    let server: Server;
    let tarball: Buffer;
    let integrity: string;

    beforeEach(async () => {
      tarball = await packTgz(
        writeFiles(tempDir(), {
          'wormwright-plugin.json': pluginManifest('from-npm', { version: '1.2.0' }),
          'server.js': 'export default { register() {} }',
        }),
      );
      integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
      server = createServer((req, res) => {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        if (req.url === '/@acme%2fww-plugin') {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              'dist-tags': { latest: '1.2.0' },
              versions: {
                '1.2.0': { dist: { tarball: `${base}/t.tgz`, integrity } },
                '1.1.0': { dist: { tarball: `${base}/t.tgz`, integrity: 'sha512-AAAA' } },
              },
            }),
          );
        } else if (req.url === '/t.tgz') res.end(tarball);
        else res.writeHead(404).end('{}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      installer = new FilePluginInstaller({
        pluginsDir,
        registryUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      });
    });

    afterEach(() => {
      server.close();
    });

    it('downloads the latest version and checks its integrity', async () => {
      const staged = await installer.stage({ kind: 'npm', name: '@acme/ww-plugin', version: null });
      expect(staged).toMatchObject({ kind: 'plugin', manifest: { id: 'from-npm', version: '1.2.0' } });
      await expect(
        installer.stage({ kind: 'npm', name: '@acme/ww-plugin', version: '1.1.0' }),
      ).rejects.toThrow('does not match its integrity hash');
      await expect(
        installer.stage({ kind: 'npm', name: '@acme/ww-plugin', version: '9.9.9' }),
      ).rejects.toThrow('no version "9.9.9"');
      await expect(installer.stage({ kind: 'npm', name: 'missing', version: null })).rejects.toThrow(
        'npm has no package "missing"',
      );
    });
  });

  it('lists built catalogue packages and installs them without sources', async () => {
    const catalogDir = tempDir('ww-catalog-');
    writeFiles(catalogDir, {
      'built/wormwright-plugin.json': pluginManifest('built', {
        server: 'dist/server.js',
        description: 'Hi',
      }),
      'built/dist/server.js': 'export default { register() {} }',
      'built/dist/server.test.js': '',
      'built/dist/.tsbuildinfo': '',
      'built/src/server.ts': 'export {}',
      'built/node_modules/x/index.js': '',
      'unbuilt/wormwright-plugin.json': pluginManifest('unbuilt', { server: 'dist/server.js' }),
      'theme-sunset/wormwright-theme.json': theme,
      'notes/readme.md': 'not a package',
    });
    installer = new FilePluginInstaller({ pluginsDir, catalogDir });
    expect(await installer.catalog()).toEqual([
      {
        source: 'catalog:built',
        kind: 'plugin',
        id: 'built',
        name: 'Plugin built',
        version: '1.0.0',
        description: 'Hi',
      },
      {
        source: 'catalog:theme-sunset',
        kind: 'theme',
        id: 'sunset',
        name: 'Sunset',
        version: '1.0.0',
        description: null,
      },
    ]);
    const staged = await installer.stage({ kind: 'catalog', name: 'built' });
    expect(readdirSync(staged.directory).sort()).toEqual(['dist', 'wormwright-plugin.json']);
    expect(readdirSync(join(staged.directory, 'dist'))).toEqual(['server.js']);
    await expect(installer.stage({ kind: 'catalog', name: 'nope' })).rejects.toThrow('No catalogue entry');
  });

  it('ships the first-party theme in the real catalogue', async () => {
    const real = new FilePluginInstaller({ pluginsDir, catalogDir: CATALOG_DIR });
    expect(await real.catalog()).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'catalog:theme-amarr', id: 'amarr' })]),
    );
  });
});
