import { NotFoundError, UnauthenticatedError, ValidationError, type Clock } from '@wormwright/core';
import type { PendingAuth } from '../domain/pending-auth.js';
import { PENDING_AUTH_TTL_MS, safeReturnTo } from '../domain/rules.js';
import { pkceChallenge, randomToken, sameSecret } from './crypto.js';
import { ExternalAuthError } from '../domain/errors.js';

/** Fresh state and PKCE verifier for a redirect to an OAuth provider. */
export async function beginPendingAuth(
  clock: Clock,
  input: Pick<PendingAuth, 'kind' | 'accountId'> & { returnTo: unknown },
): Promise<{ pending: PendingAuth; codeChallenge: string }> {
  const pending: PendingAuth = {
    kind: input.kind,
    state: randomToken(),
    codeVerifier: randomToken(),
    returnTo: safeReturnTo(input.returnTo),
    accountId: input.accountId,
    expiresAt: clock.now() + PENDING_AUTH_TTL_MS,
  };
  return { pending, codeChallenge: await pkceChallenge(pending.codeVerifier) };
}

/** Checks that a callback belongs to the round trip this browser started. */
export function checkPendingAuth(
  clock: Clock,
  kind: PendingAuth['kind'],
  pending: PendingAuth | null,
  state: string | undefined,
): PendingAuth {
  if (!pending || pending.kind !== kind || pending.expiresAt <= clock.now()) {
    throw new ValidationError('The sign-in took too long or was started elsewhere. Please try again.');
  }
  if (!state || !sameSecret(state, pending.state)) {
    throw new ValidationError('The sign-in could not be verified. Please try again.');
  }
  return pending;
}

export function requireConfigured<T>(provider: T | null, name: string): T {
  if (!provider) throw new NotFoundError(`${name} sign-in`);
  return provider;
}

/** A provider refusing our code or token means the user is not signed in with it. */
export async function asAuthFailure<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ExternalAuthError) throw new UnauthenticatedError(error.message);
    throw error;
  }
}
