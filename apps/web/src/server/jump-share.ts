import { headers } from 'next/headers';
import { connection } from 'next/server';
import { cache } from 'react';
import { ApiErrorBody, buildPath, routes, type JumpShareViewDto } from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import { internalApiUrl } from './api';

/**
 * A shared jump route (`/j/<token>`) as the API serves it to anyone: read WITHOUT the visitor's
 * cookies, with the client address passed on so the per-address limit counts visitors. Null when
 * nobody shared that token. Deduplicated per request (page and metadata read it once).
 */
export const getJumpShare = cache(async (token: string): Promise<JumpShareViewDto | null> => {
  const incoming = await headers();
  await connection();
  const forwarded = incoming.get('x-forwarded-for');
  const response = await fetch(`${internalApiUrl()}${buildPath(routes.public.jumpShare.path, { token })}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'user-agent': incoming.get('user-agent') ?? 'darkbeacon-web',
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
    },
  });
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorBody.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(
      response.status,
      response.status >= 500 ? 'internal' : 'bad_request',
      response.statusText,
    );
  }
  return routes.public.jumpShare.response.parse(body);
});
