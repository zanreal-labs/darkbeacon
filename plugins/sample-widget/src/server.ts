// Runs from DATA_DIR/plugins, where no packages are installed: SDK imports are types only.
import type { ServerPlugin } from '@darkbeacon/plugin-sdk';

export interface MapStats {
  systems: number;
  connections: number;
  since: number;
}

const plugin: ServerPlugin<'clock'> & { stats: Map<string, MapStats> } = {
  stats: new Map(),

  register(ctx) {
    const since = ctx.ports.clock.now();
    const bump = (stream: string, key: 'systems' | 'connections') => {
      const mapId = stream.slice('map:'.length);
      const current = this.stats.get(mapId) ?? { systems: 0, connections: 0, since };
      this.stats.set(mapId, { ...current, [key]: current[key] + 1 });
    };

    ctx.on('system.added', (event) => bump(event.stream, 'systems'));
    ctx.on('connection.added', (event) => bump(event.stream, 'connections'));

    // GET /api/plugins/sample-widget/stats/<mapId>
    ctx.http.route({
      method: 'GET',
      path: '/stats/:mapId',
      handler: (request) => {
        if (!request.accountId) return { status: 401, body: { error: 'sign in first' } };
        // Maps the caller cannot view are reported as missing, like the core API does.
        if (request.mapRole === null || request.mapRole === 'blocked') {
          return { status: 404, body: { error: 'no such map' } };
        }
        const mapId = request.params.mapId!;
        return { body: this.stats.get(mapId) ?? { systems: 0, connections: 0, since } };
      },
    });
  },

  dispose() {
    this.stats.clear();
  },
};

export default plugin;
