import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from './lib/safe-next';

/** Cookie names shared with the API server (apps/server/src/modules/identity/cookies.ts). */
export const SESSION_COOKIES = ['dbk_session', 'ww_session'] as const;
export const DEMO_OPT_OUT_COOKIE = 'dbk_demo_out';

function apiUrl(path: string): string {
  return `${(process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')}${path}`;
}

/**
 * A redirect to a path on the address the visitor used: the API server in front (and any reverse
 * proxy before it) pass that on as `x-forwarded-host` / `x-forwarded-proto`.
 */
function redirectTo(request: NextRequest, path: string): NextResponse {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    request.nextUrl.protocol.replace(':', '');
  return NextResponse.redirect(new URL(path, `${proto}://${host}`), 307);
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
    headers: { 'user-agent': request.headers.get('user-agent') ?? 'darkbeacon-web' },
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
  if (signedIn) return NextResponse.next();

  if (!request.cookies.has(DEMO_OPT_OUT_COOKIE)) {
    const setCookies = await demoSignIn(request);
    const session = setCookies?.map((c) => c.split(';')[0]!).find((c) => c.startsWith('dbk_session='));
    if (setCookies && session) {
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
  // Pages only: not the API (Nest answers it before this app sees anything), not built assets.
  matcher: ['/((?!api/|ws$|_next/static|_next/image|healthz$|favicon\\.svg$).*)'],
};
