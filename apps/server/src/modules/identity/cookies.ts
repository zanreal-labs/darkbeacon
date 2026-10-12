import type { PendingAuth } from '@darkbeacon/identity';
import type { SecretBox } from '../../adapters/identity/secret-box.js';
import type { RequestLike } from '../../platform/actor.js';

export const SESSION_COOKIE = 'dbk_session';
/**
 * The session cookie's name before the rename to Darkbeacon. Still read so nobody is signed out by the
 * upgrade; it is never set again and lapses with its 30-day Max-Age.
 */
export const LEGACY_SESSION_COOKIE = 'ww_session';
/**
 * Demo mode only: set when someone signs out, so the web app shows the sign-in page (with
 * "Explore the demo") instead of signing them straight back in. Lasts the browser session and is
 * cleared by the next demo sign-in.
 */
export const DEMO_OPT_OUT_COOKIE = 'dbk_demo_out';
/** Holds the sealed state of an OAuth round trip; scoped to /api/auth. */
export const PENDING_COOKIE = 'dbk_oauth';

export interface CookieOptions {
  /** Omitted: a browser-session cookie. */
  maxAgeSeconds?: number;
  path?: string;
  secure: boolean;
  /** Default true; false only for values page scripts must read (the theme choice). */
  httpOnly?: boolean;
}

export function readCookie(request: RequestLike, name: string): string | null {
  const header = request.headers.cookie;
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The session token from the cookie, or from the pre-rename cookie when that is all the browser has. */
export function readSessionCookie(request: RequestLike): string | null {
  return readCookie(request, SESSION_COOKIE) ?? readCookie(request, LEGACY_SESSION_COOKIE);
}

/**
 * httpOnly (unless asked otherwise), SameSite=Lax: sent on top-level navigations (OAuth
 * callbacks), never on cross-site POSTs.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    ...(options.maxAgeSeconds !== undefined ? [`Max-Age=${options.maxAgeSeconds}`] : []),
    ...(options.httpOnly === false ? [] : ['HttpOnly']),
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, options: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}

export function sealPending(box: SecretBox, pending: PendingAuth): string {
  return box.seal(JSON.stringify(pending));
}

export function openPending(box: SecretBox, sealed: string | null): PendingAuth | null {
  if (!sealed) return null;
  const json = box.open(sealed);
  if (!json) return null;
  try {
    return JSON.parse(json) as PendingAuth;
  } catch {
    return null;
  }
}
