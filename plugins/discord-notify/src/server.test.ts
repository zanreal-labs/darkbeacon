import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent, Notifier, PluginContext } from '@wormwright/plugin-sdk';
import plugin, { describe as describeEvent, wants, type DiscordSettings } from './server.js';

const HOOK = 'https://discord.com/api/webhooks/1/abc';

function fakeContext(
  settings: Partial<DiscordSettings> & { maps?: Record<string, Partial<DiscordSettings>> },
) {
  const handlers = new Map<string, (event: DomainEvent) => Promise<void> | void>();
  const provided: Notifier[] = [];
  const base = { events: ['system.added'], username: 'Wormwright', ...settings };
  const ctx = {
    plugin: { id: 'discord-notify', version: '1.0.0' },
    ports: {
      maps: {
        getMap: async (id: string) => ({ id, name: 'Home chain' }),
        listSystems: async () => [],
        listConnections: async () => [],
      },
      universe: {
        getSystem: (id: number) => (id === 31000005 ? { name: 'Thera' } : null),
        searchSystems: () => [],
      },
    },
    on: (type: string, handler: (event: DomainEvent) => Promise<void>) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    settings: {
      get: async () => base,
      forMap: async (mapId: string) => ({ ...base, ...settings.maps?.[mapId] }),
    },
    provide: (_port: string, adapter: Notifier) => provided.push(adapter),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    http: { route() {} },
    commands: { run: async () => null },
  } as unknown as PluginContext<'maps' | 'universe'>;
  return { ctx, handlers, provided };
}

const event = (type: string, data: unknown, stream = 'map:m1') =>
  ({
    id: 'e1',
    seq: 1,
    stream,
    type,
    occurredAt: Date.UTC(2026, 9, 11),
    actor: { kind: 'system', id: 't' },
    data,
    v: 1,
  }) as DomainEvent;

describe('discord-notify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts chosen events of a map to its Discord webhook', async () => {
    const posted = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', posted);
    const { ctx, handlers } = fakeContext({ webhookUrl: HOOK, maps: { m2: { webhookUrl: undefined } } });
    await plugin.register(ctx);
    expect([...handlers.keys()]).toEqual(['system.*', 'connection.*', 'signature.*', 'ping.*']);

    await handlers.get('system.*')!(event('system.added', { solarSystemId: 31000005 }));
    await handlers.get('system.*')!(event('system.removed', { solarSystemId: 31000005 }));
    await handlers.get('system.*')!(event('system.added', { solarSystemId: 31000005 }, 'map:m2'));

    expect(posted).toHaveBeenCalledTimes(1);
    const [url, init] = posted.mock.calls[0]!;
    expect(url).toBe(HOOK);
    expect(JSON.parse(String(init.body))).toMatchObject({
      username: 'Wormwright',
      embeds: [
        {
          title: 'Home chain: system.added',
          description: 'Thera was added',
          timestamp: '2026-10-11T00:00:00.000Z',
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it('fails loudly on Discord errors but not on rate limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 429 })),
    );
    const { ctx, handlers, provided } = fakeContext({ webhookUrl: HOOK });
    await plugin.register(ctx);
    await handlers.get('system.*')!(event('system.added', { solarSystemId: 1 }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(handlers.get('system.*')!(event('system.added', { solarSystemId: 1 }))).rejects.toThrow(
      'Discord answered 404',
    );
    await expect(provided[0]!.send({ mapId: null, title: 'Hi', body: 'there' })).rejects.toThrow('404');
  });

  it('describes events with system names when it can', () => {
    const name = (id: number) => (id === 1 ? 'J123456' : `#${id}`);
    expect(
      describeEvent(
        event('connection.added', { source: 1, target: 2, timeStatus: 'eol', massStatus: 'fresh' }),
        'M',
        name,
      ).body,
    ).toBe('New connection: J123456 - #2 (eol, mass fresh)');
    expect(
      describeEvent(
        event('signature.added', {
          eveId: 'ABC-123',
          solarSystemId: 1,
          group: 'wormhole',
          type: 'B274',
          name: null,
        }),
        'M',
        name,
      ).body,
    ).toBe('Signature ABC-123 in J123456: wormhole B274');
    expect(describeEvent(event('labels.changed', {}), 'M', name)).toEqual({
      title: 'M: labels.changed',
      body: 'labels.changed on M',
    });
    expect(wants(['system.*'], 'system.updated')).toBe(true);
    expect(wants(['system.added'], 'system.updated')).toBe(false);
  });
});
