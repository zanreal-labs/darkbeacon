import { timingSafeEqual } from 'node:crypto';
import { ForbiddenError, UnauthenticatedError } from '@darkbeacon/core';
import type { SupportIdentity } from '@darkbeacon/support';
import type { SecretBox } from '../../adapters/identity/secret-box.js';
import { sameOrigin, type RequestLike } from '../../platform/actor.js';
import { clearCookie, readCookie, serializeCookie } from '../identity/cookies.js';

/** The hub's own session: a sealed cookie, sent only to the support API. */
export const SUPPORT_SESSION_COOKIE = 'dbk_support';
export const SUPPORT_SESSION_PATH = '/api/support';
/** The EVE SSO round trip; sent only to the callback. */
export const SUPPORT_PENDING_COOKIE = 'dbk_support_oauth';
export const SUPPORT_PENDING_PATH = '/support/callback';
export const SUPPORT_CSRF_HEADER = 'x-support-csrf';
export const SUPPORT_SESSION_DAYS = 30;

interface SealedSession {
  v: 1;
  /** distinct id, character id, character name */
  d: string;
  c: number;
  n: string;
  /** CSRF token, sent back in `x-support-csrf`. */
  x: string;
  /** Expiry, epoch ms. */
  e: number;
}

export interface HubSession {
  identity: SupportIdentity;
  csrf: string;
}

export interface PendingSupportLogin {
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

/**
 * Reads and writes the hub's cookies. The session is stateless (sealed with a key derived from
 * SECRET_KEY for this purpose only); signing out clears it, and changing SECRET_KEY ends them all.
 */
export class SupportSessions {
  constructor(
    private readonly sessionBox: SecretBox,
    private readonly pendingBox: SecretBox,
    private readonly publicOrigin: string,
    private readonly now: () => number,
  ) {}

  get secure(): boolean {
    return this.publicOrigin.startsWith('https://');
  }

  read(request: RequestLike): HubSession | null {
    const sealed = readCookie(request, SUPPORT_SESSION_COOKIE);
    const json = sealed ? this.sessionBox.open(sealed) : null;
    if (!json) return null;
    try {
      const s = JSON.parse(json) as SealedSession;
      if (s.v !== 1 || s.e <= this.now() || typeof s.d !== 'string' || typeof s.x !== 'string') return null;
      return { identity: { distinctId: s.d, characterId: s.c, characterName: s.n }, csrf: s.x };
    } catch {
      return null;
    }
  }

  /**
   * The session for a change: the cookie must be there, the request must come from the hub's own
   * pages (Origin), and carry the session's CSRF token.
   */
  require(request: RequestLike, change: boolean): HubSession {
    if (change) this.checkOrigin(request);
    const session = this.read(request);
    if (!session) throw new UnauthenticatedError('Sign in with EVE Online first');
    if (change && !this.csrfMatches(request, session.csrf))
      throw new ForbiddenError('This page is out of date; reload it and try again');
    return session;
  }

  /** A change without a session (anonymous feedback) still has to come from the hub's pages. */
  checkOrigin(request: RequestLike): void {
    if (!request.headers.origin || !sameOrigin(request.headers, this.publicOrigin))
      throw new ForbiddenError('Send this from the support page');
  }

  csrfMatches(request: RequestLike, csrf: string): boolean {
    const raw = request.headers[SUPPORT_CSRF_HEADER];
    const sent = Buffer.from(String(Array.isArray(raw) ? raw[0] : (raw ?? '')));
    const expected = Buffer.from(csrf);
    return sent.length === expected.length && timingSafeEqual(sent, expected);
  }

  sessionCookie(identity: SupportIdentity, csrf: string): string {
    const maxAgeSeconds = SUPPORT_SESSION_DAYS * 24 * 60 * 60;
    const sealed: SealedSession = {
      v: 1,
      d: identity.distinctId,
      c: identity.characterId,
      n: identity.characterName,
      x: csrf,
      e: this.now() + maxAgeSeconds * 1000,
    };
    return serializeCookie(SUPPORT_SESSION_COOKIE, this.sessionBox.seal(JSON.stringify(sealed)), {
      maxAgeSeconds,
      path: SUPPORT_SESSION_PATH,
      secure: this.secure,
    });
  }

  clearSession(): string {
    return clearCookie(SUPPORT_SESSION_COOKIE, { path: SUPPORT_SESSION_PATH, secure: this.secure });
  }

  pendingCookie(pending: PendingSupportLogin): string {
    return serializeCookie(SUPPORT_PENDING_COOKIE, this.pendingBox.seal(JSON.stringify(pending)), {
      maxAgeSeconds: Math.max(1, Math.ceil((pending.expiresAt - this.now()) / 1000)),
      path: SUPPORT_PENDING_PATH,
      secure: this.secure,
    });
  }

  clearPending(): string {
    return clearCookie(SUPPORT_PENDING_COOKIE, { path: SUPPORT_PENDING_PATH, secure: this.secure });
  }

  readPending(request: RequestLike): PendingSupportLogin | null {
    const sealed = readCookie(request, SUPPORT_PENDING_COOKIE);
    const json = sealed ? this.pendingBox.open(sealed) : null;
    if (!json) return null;
    try {
      const pending = JSON.parse(json) as PendingSupportLogin;
      return pending.expiresAt > this.now() ? pending : null;
    } catch {
      return null;
    }
  }
}

/** Where a sign-in may return to: the support page only (with its query). */
export function supportReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000) return '/support';
  try {
    const url = new URL(value, 'http://hub.invalid');
    if (url.origin !== 'http://hub.invalid') return '/support';
    if (url.pathname !== '/support' && url.pathname !== '/support/') return '/support';
    return `/support${url.search}`;
  } catch {
    return '/support';
  }
}
