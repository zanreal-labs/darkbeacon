// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { defineWebPlugin } from '@wormwright/plugin-sdk';
import '../test/setup';
import { PluginSlot } from './PluginSlot';
import { loadWebPlugins, PluginRegistry } from './registry';
import { PluginsProvider } from './PluginSlot';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function Host({ registry }: { registry: PluginRegistry }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PluginsProvider enabled={false} registry={registry}>
        <PluginSlot slot="nodeBadge" props={{ mapId: 'm', solarSystemId: 31000001 }} />
      </PluginsProvider>
    </QueryClientProvider>
  );
}

describe('web plugins', () => {
  it('render registered components into their slot, in order, with the slot props', async () => {
    const registry = new PluginRegistry();
    render(<Host registry={registry} />);
    const late = defineWebPlugin({
      register(api) {
        api.register('nodeBadge', (p) => <span>late {p.solarSystemId}</span>, { order: 200 });
      },
    });
    const early = defineWebPlugin({
      register(api) {
        api.register('nodeBadge', () => <span>early</span>, { order: 10 });
      },
    });
    await act(() =>
      loadWebPlugins(
        registry,
        [
          { id: 'late', url: '/late.js' },
          { id: 'early', url: '/early.js' },
        ],
        async (url) => ({ default: url === '/late.js' ? late : early }),
      ),
    );
    expect(screen.getAllByText(/early|late/).map((e) => e.textContent)).toEqual(['early', 'late 31000001']);
  });

  it('isolate a plugin that fails to load or crashes while rendering', async () => {
    const registry = new PluginRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Host registry={registry} />);
    const failures = await act(() =>
      loadWebPlugins(
        registry,
        [
          { id: 'broken', url: '/broken.js' },
          { id: 'crashy', url: '/crashy.js' },
          { id: 'fine', url: '/fine.js' },
        ],
        async (url) => {
          if (url === '/broken.js') throw new Error('404');
          return {
            default: defineWebPlugin({
              register(api) {
                api.register('nodeBadge', () => {
                  if (url === '/crashy.js') throw new Error('boom');
                  return <span>fine</span>;
                });
              },
            }),
          };
        },
      ),
    );
    expect(failures).toEqual([{ id: 'broken', error: '404' }]);
    expect(screen.getByText('fine')).toBeTruthy();
    warn.mockRestore();
    error.mockRestore();
  });

  it('scope plugin fetches to the plugin route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await new PluginRegistry().apiFor('kill-feed').fetch('/recent?limit=5');
    expect(fetchMock).toHaveBeenCalledWith('/api/plugins/kill-feed/recent?limit=5', {
      credentials: 'same-origin',
    });
    vi.unstubAllGlobals();
  });
});
