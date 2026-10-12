import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { dehydrate, QueryClient, type DehydratedState, type QueryKey } from '@tanstack/react-query';
import { ApiErrorBody, buildPath, routes, type RouteDef } from '@darkbeacon/shared';
import type { z } from 'zod';
import { ApiError } from '../lib/api';

/**
 * Where server components reach the API: the API server sets `INTERNAL_API_URL` when it starts
 * this app (a loopback address in the same container); `next dev` gets it from the environment.
 */
export function internalApiUrl(): string {
  return (process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

type GetRoute = RouteDef & { method: 'GET'; response: z.ZodType };

/**
 * GET an API route on behalf of the visitor: their cookies go along, the answer is checked
 * against the route's shared zod schema. Errors are `ApiError`s, like in the browser. Reading
 * cookies makes the caller request-time (it must sit inside a Suspense boundary).
 */
export async function serverGet<R extends GetRoute>(
  route: R,
  path: string = route.path,
): Promise<z.infer<R['response']>> {
  const jar = await cookies();
  const incoming = await headers();
  const response = await fetch(`${internalApiUrl()}${path}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      cookie: jar.toString(),
      'user-agent': incoming.get('user-agent') ?? 'darkbeacon-web',
    },
  });
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
  return route.response.parse(body) as z.infer<R['response']>;
}

/** `serverGet` that reads 401 as null (signed out) and 404 as null (missing or no access). */
export async function serverFind<R extends GetRoute>(
  route: R,
  path: string = route.path,
): Promise<z.infer<R['response']> | null> {
  try {
    return await serverGet(route, path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
    throw error;
  }
}

/** The signed-in account, or null. Shared by the shell and the page within one request. */
export const getMe = cache(() => serverFind(routes.accounts.me));

/** Which sign-in methods the instance offers (public). */
export const getProviders = cache(() => serverGet(routes.auth.providers));

/** The maps the visitor can see, with their role on each. */
export const getMaps = cache(() => serverGet(routes.maps.list));

export const getMapBySlug = cache((slug: string) =>
  serverFind(routes.maps.bySlug, buildPath(routes.maps.bySlug.path, { slug })),
);

/**
 * Query cache entries for the browser, so client components start with server data instead of
 * fetching it again (TanStack Query's dehydrate / HydrationBoundary).
 */
export function prefilled(entries: readonly (readonly [QueryKey, unknown])[]): DehydratedState {
  const client = new QueryClient();
  for (const [key, data] of entries) if (data !== undefined) client.setQueryData(key, data);
  return dehydrate(client);
}
