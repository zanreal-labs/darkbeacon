import type { ServerStatusReading, ServerStatusSource } from '@darkbeacon/tracking';

/** `/status` is documented under this compatibility date (https://esi.evetech.net/meta/openapi.json). */
const COMPATIBILITY_DATE = '2020-01-01';

/**
 * ESI `GET /status`: players, VIP and the server version while Tranquility is up. During
 * downtime ESI answers 503 or 504 (it cannot reach TQ); any other failure, including the
 * network, means nothing is known.
 */
export class HttpServerStatus implements ServerStatusSource {
  constructor(private readonly options: { userAgent: string; baseUrl?: string; fetch?: typeof fetch }) {}

  async read(): Promise<ServerStatusReading> {
    const base = (this.options.baseUrl ?? 'https://esi.evetech.net').replace(/\/+$/, '');
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${base}/status`, {
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          'x-compatibility-date': COMPATIBILITY_DATE,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { kind: 'unknown' };
    }
    if (response.status === 503 || response.status === 504) return { kind: 'down' };
    if (!response.ok) return { kind: 'unknown' };
    const body = (await response.json().catch(() => null)) as {
      players?: unknown;
      vip?: unknown;
      server_version?: unknown;
      start_time?: unknown;
    } | null;
    if (!body || typeof body.players !== 'number') return { kind: 'unknown' };
    const started = typeof body.start_time === 'string' ? Date.parse(body.start_time) : NaN;
    return {
      kind: 'up',
      players: body.players,
      vip: body.vip === true,
      serverVersion: typeof body.server_version === 'string' ? body.server_version : '',
      startedAt: Number.isFinite(started) ? started : null,
    };
  }
}
