import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from './lib/safe-next';

/** Cookie names shared with the API server (apps/server/src/modules/identity/cookies.ts). */
export const SESSION_COOKIES = ['dbk_session', 'ww_session'] as const;
export const DEMO_OPT_OUT_COOKIE = 'dbk_demo_out';

function apiUrl(path: string): string {
  return `${(process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')}${path}`;
}

/**
 * A redirect to a path on this site. It is resolved against the request's own URL, so Next.js
 * sends it as a relative `Location` and the browser stays on the address it used, whatever
 * reverse proxy sits in front. Forwarded headers are never trusted for it: a client could name any
 * host there.
 */
function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 307);
}

/** The app's pages; anything else (robots.txt, scanners probing /wp-login.php) is a plain 404. */
const PAGE = /^\/(?:account|admin|maps|dev\/components)?\/?$|^\/m\/[^/]+(?:\/settings)?\/?$/;

/**
 * Where `/` goes for this session (the account's star, the instance default, the last opened
 * map, the only one), or null when it can see no map or the API did not answer. The redirect
 * happens here, before any HTML, so the maps list never flashes.
 */
async function landingPath(cookie: string, request: NextRequest): Promise<string | null> {
  const response = await fetch(apiUrl('/api/accounts/me/landing'), {
    headers: {
      cookie,
      accept: 'application/json',
      'user-agent': request.headers.get('user-agent') ?? 'darkbeacon-web',
    },
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) {
    void response?.body?.cancel().catch(() => {});
    return null;
  }
  const body = (await response.json().catch(() => null)) as { slug?: unknown } | null;
  return typeof body?.slug === 'string' ? `/m/${encodeURIComponent(body.slug)}` : null;
}

/** `/` opened by someone signed in: straight to their map. */
async function land(
  request: NextRequest,
  cookie: string,
  setCookies: string[] = [],
): Promise<NextResponse | null> {
  if (request.nextUrl.pathname !== '/' || request.headers.has('next-router-prefetch')) return null;
  const path = await landingPath(cookie, request);
  if (!path) return null;
  const response = redirectTo(request, path);
  for (const c of setCookies) response.headers.append('set-cookie', c);
  return response;
}

/** Clients that are not someone browsing: crawlers, link previews, scripts, scanners. */
const NOT_A_BROWSER =
  /bot|crawl|spider|slurp|preview|scan|curl|wget|python|httpclient|okhttp|go-http|java\/|axios|^node$/i;

/**
 * A browser opening a page (a document load or a client-side navigation), not a crawler, a link
 * preview, a prefetch or a HEAD request. Only these get a demo session, so the session table does
 * not grow with every bot that passes by. Browsers send fetch metadata (`Sec-Fetch-Dest`) only to
 * HTTPS and localhost; on a plain-HTTP address an HTML request from a browser's user agent counts.
 */
function isPageVisit(request: NextRequest): boolean {
  if (request.method !== 'GET' || !PAGE.test(request.nextUrl.pathname)) return false;
  const headers = request.headers;
  if (headers.has('next-router-prefetch') || headers.get('purpose') === 'prefetch') return false;
  if (headers.has('rsc')) return true;
  const dest = headers.get('sec-fetch-dest');
  if (dest !== null) return dest === 'document';
  return (
    (headers.get('accept') ?? '').includes('text/html') &&
    !NOT_A_BROWSER.test(headers.get('user-agent') ?? 'node')
  );
}

/** Remembered for a minute: on an instance without demo mode, signed-out visits do not ask again. */
let noDemoUntil = 0;

/**
 * Signs the visit in as the demo account; returns the session cookie the API set, or null when
 * the instance does not run in demo mode.
 */
async function demoSignIn(request: NextRequest): Promise<string[] | null> {
  if (Date.now() < noDemoUntil) return null;
  const response = await fetch(apiUrl('/api/auth/demo'), {
    method: 'POST',
    // The browser's cookies (a saved theme choice) tell the API what the new session must not override.
    headers: {
      'user-agent': request.headers.get('user-agent') ?? 'darkbeacon-web',
      cookie: request.headers.get('cookie') ?? '',
    },
    cache: 'no-store',
  }).catch(() => null);
  // Only the cookies matter; the body (the account) is read by the page itself.
  void response?.body?.cancel().catch(() => {});
  if (!response?.ok) {
    if (response?.status === 404) noDemoUntil = Date.now() + 60_000;
    return null;
  }
  return response.headers.getSetCookie();
}

/**
 * Runs before every page. A visit without a session cookie is signed in on the spot in demo mode
 * (so the very first HTML is the signed-in app), else sent to the sign-in page. Whether a session
 * is still valid is checked where the page reads the account; this only looks at the cookie.
 *
 * `/login` sends a visit with a session on to `next`; `/login?reset=1` drops a session cookie the
 * API no longer knows first, then continues to `next`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = request.nextUrl;
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (pathname === '/login') {
    const next = safeNext(searchParams.get('next'));
    if (searchParams.has('reset')) {
      const response = redirectTo(request, next);
      for (const name of SESSION_COOKIES) response.cookies.delete(name);
      return response;
    }
    // Signed in already (the back button after signing in): go on. A session the API no longer
    // knows comes back here with `reset`, so this cannot loop.
    return signedIn ? redirectTo(request, next) : NextResponse.next();
  }
  if (!PAGE.test(pathname)) return NextResponse.next();
  if (signedIn) {
    return (await land(request, request.headers.get('cookie') ?? '')) ?? NextResponse.next();
  }

  if (!request.cookies.has(DEMO_OPT_OUT_COOKIE) && isPageVisit(request)) {
    const setCookies = await demoSignIn(request);
    const session = setCookies?.map((c) => c.split(';')[0]!).find((c) => c.startsWith('dbk_session='));
    if (setCookies && session) {
      const landed = await land(request, session, setCookies);
      if (landed) return landed;
      // The page renders with the new session right away, and the browser keeps it.
      const headers = new Headers(request.headers);
      headers.set('cookie', [request.headers.get('cookie'), session].filter(Boolean).join('; '));
      const response = NextResponse.next({ request: { headers } });
      for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
      return response;
    }
  }

  const next = pathname + request.nextUrl.search;
  return redirectTo(request, next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`);
}

export const config = {
  // Pages only: not the API (Nest answers it before this app sees anything), not built assets,
  // not the files crawlers and browsers ask for on their own.
  matcher: [
    '/((?!api/|ws$|_next/static|_next/image|healthz$|favicon\\.svg$|favicon\\.ico$|icons/|manifest\\.webmanifest$|robots\\.txt$|sitemap\\.xml$|apple-touch-icon[^/]*\\.png$|\\.well-known/).*)',
  ],
};
