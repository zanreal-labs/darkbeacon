/**
 * What the service worker does with one request. Conservative on purpose: Darkbeacon is live (the
 * map, presence, the WebSocket), signed in and full of SSO redirects, and a stale answer is worse
 * than none. So only build output and icons are ever cached, and pages are fetched from the network
 * every time (the offline page stands in only when there is no network at all).
 *
 * - `static`: cache-first. Content-hashed build output (`/_next/static/`, fonts included) and the
 *   icons; the cache is per build and dropped when the next build's worker takes over.
 * - `navigate`: a page load. Network first, never cached; the offline page when the network fails.
 * - `network`: not intercepted at all; the browser handles it as if there were no service worker.
 *
 * Both functions are copied verbatim into `/sw.js` (`sw-script.ts`): they must stay self-contained
 * (no imports, nothing from outside their bodies).
 */
export type SwStrategy = 'static' | 'navigate' | 'network';

export interface SwRequestLike {
  url: string;
  method: string;
  /** `navigate` for a page load. */
  mode: string;
  headers: { get(name: string): string | null };
}

export function swStrategy(request: SwRequestLike, origin: string): SwStrategy {
  if (request.method !== 'GET') return 'network';
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'network';
  }
  if (url.origin !== origin) return 'network';
  const path = url.pathname;
  // Never touched: the API (sign-in and SSO callbacks live under /api/auth), the socket, MCP and
  // OAuth, the support hub, metrics and health, and the worker's own files.
  const never = [
    /^\/api(?:\/|$)/,
    /^\/ws(?:\/|$)/,
    /^\/mcp(?:\/|$)/,
    /^\/auth(?:\/|$)/,
    /^\/oauth(?:\/|$)/,
    /^\/\.well-known\//,
    /^\/support/,
    /^\/metrics(?:\/|$)/,
    /^\/healthz(?:\/|$)/,
    /^\/sw\.js$/,
    /^\/manifest\.webmanifest$/,
  ];
  if (never.some((re) => re.test(path))) return 'network';
  if (request.mode === 'navigate') return 'navigate';
  // Credentials-dependent content: client navigations (RSC payloads), prefetches, ranges, anything
  // asking for authorization.
  const headers = request.headers;
  if (headers.get('rsc') || headers.get('next-router-prefetch') || url.searchParams.has('_rsc'))
    return 'network';
  if (headers.get('authorization') || headers.get('range')) return 'network';
  if (path.startsWith('/_next/static/')) return 'static';
  if (path.startsWith('/icons/') || path === '/favicon.svg' || path === '/offline.html') return 'static';
  return 'network';
}

export interface SwResponseLike {
  status: number;
  /** `basic` for a same-origin answer. */
  type: string;
  headers: { get(name: string): string | null };
}

/** Whether an answer for a `static` request may be kept: a plain, public, same-origin 200. */
export function swCacheable(response: SwResponseLike): boolean {
  if (response.status !== 200 || response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('cache-control') ?? '').toLowerCase();
  if (/no-store|private/.test(cacheControl)) return false;
  const vary = (response.headers.get('vary') ?? '').toLowerCase();
  return !/cookie|authorization|\*/.test(vary);
}
