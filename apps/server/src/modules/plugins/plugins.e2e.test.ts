import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Actor } from '@wormwright/core';
import { describeEachDialect } from '@wormwright/db/testing';
import type { PluginDto, PluginWebDto, ThemeDto, ThemesDto } from '@wormwright/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';
import {
  fixtureServer,
  packTgz,
  pluginManifest,
  tempDir,
  writeFiles,
} from '../../plugins/packages.test-support.js';

const actors: Record<string, Actor> = {
  'Bearer admin': { kind: 'account', id: 'admin', instanceRole: 'admin' },
  'Bearer alice': { kind: 'account', id: 'alice', instanceRole: 'user' },
};

describeEachDialect('plugins and themes over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DATA_DIR: tempDir('ww-data-') }),
      secretKey: 'x'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false, webDist: '/nonexistent' });
    app.get(ActorResolverRegistry).use(async (req) => actors[String(req.headers.authorization)] ?? null);
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const call = async (method: string, path: string, as?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(as ? { authorization: `Bearer ${as}` } : {}),
        ...(body instanceof Buffer
          ? { 'content-type': 'application/gzip' }
          : body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
      },
      body:
        body instanceof Buffer ? new Uint8Array(body) : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('json') && text;
    return {
      status: response.status,
      headers: response.headers,
      body: isJson ? (JSON.parse(text) as unknown) : null,
      text,
    };
  };

  it('installs, runs, serves and removes a plugin', async () => {
    expect((await call('GET', '/api/admin/plugins', 'alice')).status).toBe(403);

    const tgz = await packTgz(
      writeFiles(tempDir(), {
        'wormwright-plugin.json': pluginManifest('fx', { web: 'web/web.js', events: ['system.*'] }),
        'server.js': fixtureServer(),
        'web/web.js': 'export default { register(api) {} };',
      }),
    );
    const installed = await call('POST', '/api/admin/plugins/upload', 'admin', tgz);
    expect(installed.status).toBe(201);
    expect(installed.body).toMatchObject({ id: 'fx', enabled: false, hasWeb: true, events: ['system.*'] });
    expect((await call('GET', '/api/plugins/fx/hello/bob', 'alice')).status).toBe(404);

    const enabled = await call('PUT', '/api/admin/plugins/fx/enabled', 'admin', { enabled: true });
    expect(enabled.body).toMatchObject({ enabled: true });
    expect((await call('GET', '/api/plugins/fx/hello/bob?q=2', 'alice')).body).toEqual({
      hello: 'bob',
      account: 'alice',
      q: '2',
    });
    expect((await call('GET', '/api/plugins/fx/hello/anon')).body).toMatchObject({ account: null });
    expect((await call('POST', '/api/plugins/fx/boom', 'alice')).status).toBe(500);

    const web = (await call('GET', '/api/plugins/web', 'alice')).body as PluginWebDto[];
    expect(web).toEqual([
      {
        id: 'fx',
        url: expect.stringMatching(/^\/api\/plugins\/fx\/assets\/web\.js\?rev=1\.0\.0/),
        disabledMapIds: [],
      },
    ]);
    const asset = await call('GET', web[0]!.url, 'alice');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.text).toContain('register(api)');
    expect((await call('GET', '/api/plugins/fx/assets/..%2Fserver.js', 'alice')).status).toBe(404);
    expect((await call('GET', '/api/plugins/web')).status).toBe(401);

    expect((await call('PUT', '/api/admin/plugins/fx/settings', 'admin', { values: {} })).status).toBe(400);
    const list = (await call('GET', '/api/admin/plugins', 'admin')).body as PluginDto[];
    expect(list.map((p) => p.id)).toEqual(['fx']);

    expect((await call('DELETE', '/api/admin/plugins/fx', 'admin')).status).toBe(204);
    expect((await call('GET', '/api/plugins/fx/hello/bob', 'alice')).status).toBe(404);
    expect((await call('GET', '/api/admin/plugins', 'admin')).body).toEqual([]);
  });

  it('rejects bad installs with a readable error', async () => {
    const bad = await call('POST', '/api/admin/plugins/upload', 'admin', Buffer.from('nope'));
    expect(bad).toMatchObject({ status: 400, body: { error: { code: 'validation' } } });
    const unknown = await call('POST', '/api/admin/plugins', 'admin', { source: 'catalog:does-not-exist' });
    expect(unknown).toMatchObject({
      status: 400,
      body: { error: { message: 'No catalogue entry "does-not-exist"' } },
    });
    const catalog = await call('GET', '/api/admin/plugins/catalog', 'admin');
    expect(catalog.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'amarr', kind: 'theme' })]),
    );
  });

  it('installs themes and keeps the default and each account’s choice', async () => {
    const initial = (await call('GET', '/api/themes')).body as ThemesDto;
    expect(initial.themes.map((th) => th.id)).toEqual(['default', 'dark', 'contrast']);
    expect(initial).toMatchObject({ defaultThemeId: 'system', selectedThemeId: null });

    const amarr = await call('POST', '/api/admin/themes', 'admin', { source: 'catalog:theme-amarr' });
    expect(amarr.status).toBe(201);
    const tokens = (amarr.body as ThemeDto).tokens;
    expect(tokens['color-accent']).toBe('#d4a017');
    expect(tokens.radius).toBe(initial.themes[1]!.tokens.radius);

    expect(
      (await call('PUT', '/api/admin/themes/default', 'admin', { themeId: 'amarr' })).body,
    ).toMatchObject({
      defaultThemeId: 'amarr',
    });
    expect((await call('PUT', '/api/admin/themes/default', 'alice', { themeId: 'dark' })).status).toBe(403);
    await call('PUT', '/api/accounts/me/theme', 'alice', { themeId: 'contrast' });
    expect((await call('GET', '/api/themes', 'alice')).body).toMatchObject({
      defaultThemeId: 'amarr',
      selectedThemeId: 'contrast',
    });
    expect((await call('PUT', '/api/accounts/me/theme', undefined, { themeId: 'dark' })).status).toBe(401);

    const uploaded = await call(
      'POST',
      '/api/admin/themes/upload',
      'admin',
      await packTgz(
        writeFiles(tempDir(), {
          'wormwright-theme.json': {
            id: 'sunset',
            name: 'Sunset',
            version: '1.0.0',
            colorScheme: 'light',
            tokens: {},
          },
        }),
      ),
    );
    expect(uploaded.body).toMatchObject({ id: 'sunset', builtIn: false });

    expect((await call('DELETE', '/api/admin/themes/amarr', 'admin')).status).toBe(204);
    expect((await call('GET', '/api/themes', 'alice')).body).toMatchObject({ defaultThemeId: 'system' });
  });

  it('hides webhooks of maps nobody can see', async () => {
    expect((await call('GET', '/api/maps/m1/webhooks', 'alice')).status).toBe(404);
  });
});
