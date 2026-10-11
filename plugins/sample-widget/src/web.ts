// Loaded by the browser as a plain ES module: no imports at runtime, React comes from the host.
import type { WebPlugin, WebPluginApi } from '@wormwright/plugin-sdk';
import type { MapStats } from './server.js';

function statsWidget(api: WebPluginApi) {
  const h = api.react.createElement;
  return function SampleWidget({ mapId }: { mapId: string }) {
    const [stats, setStats] = api.react.useState<MapStats | null>(null);
    const [failed, setFailed] = api.react.useState(false);

    api.react.useEffect(() => {
      let active = true;
      const load = () =>
        api
          .fetch(`/stats/${encodeURIComponent(mapId)}`)
          .then((r) => (r.ok ? (r.json() as Promise<MapStats>) : Promise.reject(new Error(String(r.status)))))
          .then((s) => active && setStats(s))
          .catch(() => active && setFailed(true));
      void load();
      const timer = setInterval(load, 15_000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [mapId]);

    if (failed) return h('p', null, 'Stats are not available.');
    if (!stats) return h('p', null, 'Loading...');
    return h(
      'p',
      null,
      `${stats.systems} systems and ${stats.connections} connections added since `,
      h(
        'time',
        { dateTime: new Date(stats.since).toISOString() },
        new Date(stats.since).toLocaleTimeString(),
      ),
      '.',
    );
  };
}

const plugin: WebPlugin = {
  register(api) {
    api.register('widget', statsWidget(api), { title: 'Added since start' });
  },
};

export default plugin;
