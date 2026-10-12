import { headers } from 'next/headers';
import { connection } from 'next/server';
import { cache } from 'react';
import { ApiErrorBody, buildPath, routes, type PublicMapViewDto } from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import { internalApiUrl } from './api';

/**
 * A public map (`/p/<token>`) as the API serves it to anyone: read WITHOUT the visitor's cookies,
 * so a signed-in visitor sees exactly what everyone else sees and no session is ever involved.
 * The client address goes along (`x-forwarded-for`, as the front door set it), so the API's
 * per-address rate limit counts visitors, not this server. Null when the link does not work
 * (unknown, switched off, regenerated, public maps off). Deduplicated per request, so the page
 * and its metadata read it once.
 */
export const getPublicMap = cache(async (token: string): Promise<PublicMapViewDto | null> => {
  const incoming = await headers();
  // Request time only, never during a prerender.
  await connection();
  const forwarded = incoming.get('x-forwarded-for');
  const response = await fetch(`${internalApiUrl()}${buildPath(routes.public.map.path, { token })}`, {
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
  return routes.public.map.response.parse(body);
});
