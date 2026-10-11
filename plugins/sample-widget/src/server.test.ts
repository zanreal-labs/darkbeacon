import { describe, expect, it } from 'vitest';
import type { DomainEvent, PluginContext, PluginRoute, WebPluginApi } from '@wormwright/plugin-sdk';
import plugin from './server.js';
import webPlugin from './web.js';

describe('sample-widget', () => {
  it('counts additions per map and serves them to signed-in users', async () => {
    const handlers = new Map<string, (event: DomainEvent) => void>();
    const routes: PluginRoute[] = [];
    const ctx = {
      ports: { clock: { now: () => 1000 } },
      on: (type: string, handler: (event: DomainEvent) => void) => {
        handlers.set(type, handler);
        return () => undefined;
      },
      http: { route: (route: PluginRoute) => routes.push(route) },
    } as unknown as PluginContext<'clock'>;
    await plugin.register(ctx);

    const emit = (type: string, stream: string) => handlers.get(type)!({ type, stream } as DomainEvent);
    emit('system.added', 'map:m1');
    emit('system.added', 'map:m1');
    emit('connection.added', 'map:m1');
    emit('system.added', 'map:m2');

    const stats = routes[0]!;
    const request = { method: 'GET', query: {}, body: null, params: { mapId: 'm1' }, accountId: 'alice' };
    expect(await stats.handler(request)).toEqual({ body: { systems: 2, connections: 1, since: 1000 } });
    expect(await stats.handler({ ...request, params: { mapId: 'm9' } })).toEqual({
      body: { systems: 0, connections: 0, since: 1000 },
    });
    expect(await stats.handler({ ...request, accountId: null })).toMatchObject({ status: 401 });

    await plugin.dispose?.();
    expect(await stats.handler(request)).toMatchObject({ body: { systems: 0 } });
  });

  it('registers one widget with the host', () => {
    const registered: Array<{ slot: string; title?: string }> = [];
    const api = {
      pluginId: 'sample-widget',
      react: {
        createElement: () => null,
        useState: (v: unknown) => [v, () => undefined],
        useEffect: () => undefined,
      },
      register: (slot: string, _component: unknown, options?: { title?: string }) =>
        registered.push({ slot, ...(options?.title ? { title: options.title } : {}) }),
      fetch: async () => new Response('{}'),
    } as unknown as WebPluginApi;
    void webPlugin.register(api);
    expect(registered).toEqual([{ slot: 'widget', title: 'Added since start' }]);
  });
});
