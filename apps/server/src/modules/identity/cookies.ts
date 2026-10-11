import type { PendingAuth } from '@wormwright/identity';
import type { SecretBox } from '../../adapters/identity/secret-box.js';
import type { RequestLike } from '../../platform/actor.js';

export const SESSION_COOKIE = 'ww_session';
/** Holds the sealed state of an OAuth round trip; scoped to /api/auth. */
export const PENDING_COOKIE = 'ww_oauth';

export interface CookieOptions {
  maxAgeSeconds: number;
  path?: string;
  secure: boolean;
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

/** httpOnly, SameSite=Lax: sent on top-level navigations (OAuth callbacks), never on cross-site POSTs. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${options.maxAgeSeconds}`,
    'HttpOnly',
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
