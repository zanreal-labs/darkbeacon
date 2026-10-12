import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { EsiExchange } from '@darkbeacon/observability';

interface UndiciRequest {
  origin?: string | URL;
  method?: string;
  path?: string;
}

interface UndiciResponse {
  statusCode: number;
  /** Alternating names and values. */
  headers: Array<Buffer | string>;
}

const ESI = 'esi.evetech.net';

function headerLookup(raw: Array<Buffer | string>): (name: string) => string | null {
  const headers = new Map<string, string>();
  for (let i = 0; i + 1 < raw.length; i += 2) headers.set(String(raw[i]).toLowerCase(), String(raw[i + 1]));
  return (name) => headers.get(name.toLowerCase()) ?? null;
}

/**
 * Sees every ESI request made with `fetch` (tracking, the directory, routing, plugins) through
 * undici's diagnostics channels, without touching the adapters that make them. Returns a
 * function that stops listening.
 */
export function listenToEsi(record: (exchange: EsiExchange) => void): () => void {
  const started = new WeakMap<object, { url: string; method: string; at: number }>();
  const onCreate = (message: unknown) => {
    const { request } = message as { request: UndiciRequest };
    const origin = String(request.origin ?? '');
    if (!origin.includes(ESI)) return;
    started.set(request, {
      url: `${origin.replace(/\/+$/, '')}${request.path ?? '/'}`,
      method: request.method ?? 'GET',
      at: performance.now(),
    });
  };
  const onHeaders = (message: unknown) => {
    const { request, response } = message as { request: object; response: UndiciResponse };
    const start = started.get(request);
    if (!start) return;
    started.delete(request);
    record({
      url: start.url,
      method: start.method,
      status: response.statusCode,
      seconds: (performance.now() - start.at) / 1000,
      header: headerLookup(response.headers),
    });
  };
  const onError = (message: unknown) => {
    const { request, error } = message as { request: object; error: { code?: string; name?: string } };
    const start = started.get(request);
    if (!start) return;
    started.delete(request);
    record({
      url: start.url,
      method: start.method,
      status: null,
      seconds: (performance.now() - start.at) / 1000,
      errorType: error?.code ?? error?.name ?? 'network',
    });
  };
  subscribe('undici:request:create', onCreate);
  subscribe('undici:request:headers', onHeaders);
  subscribe('undici:request:error', onError);
  return () => {
    unsubscribe('undici:request:create', onCreate);
    unsubscribe('undici:request:headers', onHeaders);
    unsubscribe('undici:request:error', onError);
  };
}
