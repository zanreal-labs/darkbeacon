import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { DiscordNotifyStateDto, MapDto, MapSystemDto, PluginDto } from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { tempDir } from '../../plugins/packages.test-support.js';
import { Browser } from '../../test-support/browser.js';

const HOOK = 'https://discord.com/api/webhooks/42/abcdefghijklmnopqrstuvwxyz';

/**
 * The bundled discord-notify plugin through the real app: installed from the catalogue (its
 * built files, `pnpm build` or `tsc -b`), set up on a map, fed by its durable consumer.
 */
describeEachDialect('Discord notifications of a map', (t) => {
  let app: NestFastifyApplication;
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });

  it('posts a map change to the map webhook, batched, through the plugin', async () => {
    const posted: Array<Record<string, unknown>> = [];
    // The plugin calls Discord with the global fetch; everything else goes through.
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === HOOK) return new Response(JSON.stringify({ name: 'Alerts' }), { status: 200 });
      if (target === `${HOOK}?wait=true`) {
        posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'm' }), { status: 200 });
      }
      if (target.startsWith('https://')) return new Response('{}', { status: 404 });
      return realFetch(url, init);
    });

    const config = {
      ...parseEnv({
        NODE_ENV: 'test',
        DATA_DIR: tempDir('dbk-notify-'),
        DEMO_MODE: 'true',
        PUBLIC_URL: 'https://beacon.example',
      }),
      secretKey: 'x'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const owner = new Browser(`127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });

    const plugin = await owner.json<PluginDto>('/api/admin/plugins', {
      method: 'POST',
      json: { source: 'catalog:discord-notify' },
    });
    expect(plugin).toMatchObject({ id: 'discord-notify', error: null });
    await owner.json(`/api/admin/plugins/discord-notify/enabled`, { method: 'PUT', json: { enabled: true } });

    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Home chain' } });
    const path = `/api/plugins/discord-notify/maps/${map.id}`;
    const saved = await owner.json<DiscordNotifyStateDto>(path, {
      method: 'PUT',
      json: { target: { kind: 'webhook', url: HOOK } },
    });
    expect(saved.target).toMatchObject({ kind: 'webhook', label: 'Webhook “Alerts”' });

    // Two systems and a connection between them: the connection is a notification.
    await owner.json<MapSystemDto>(`/api/maps/${map.id}/systems`, {
      method: 'POST',
      json: { solarSystemId: 31002238 },
    });
    await owner.json<MapSystemDto>(`/api/maps/${map.id}/systems`, {
      method: 'POST',
      json: { solarSystemId: 30002537 },
    });
    await owner.json(`/api/maps/${map.id}/connections`, {
      method: 'POST',
      json: { source: 31002238, target: 30002537 },
    });
    await vi.waitFor(async () => {
      await app.get(EventConsumers).wake();
      expect((await owner.json<DiscordNotifyStateDto>(path)).status.pending).toBe(1);
    });

    // The test post goes out at once, without waiting for a batch.
    expect(await owner.json(`${path}/test`, { method: 'POST' })).toEqual({ ok: true, error: null });
    expect(posted).toHaveLength(1);
    expect((posted[0]!.embeds as Array<{ title: string }>)[0]!.title).toBe('Darkbeacon is connected');

    // Somebody else on the instance may not see or change it.
    const other = new Browser(`127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    await other.json('/api/auth/dev', { method: 'POST', json: { name: 'other' } });
    expect((await other.request(path)).status).toBe(404);
  });
});
