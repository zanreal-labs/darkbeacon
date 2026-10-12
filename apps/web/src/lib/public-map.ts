import { buildPath, routes, type PublicMapViewDto } from '@darkbeacon/shared';
import { ApiError } from './api';

/**
 * A public map's view, read again in the browser (after the link changed or its stream ended).
 * No cookies go along: the public view is the same for everyone. Null when the link is gone.
 */
export async function fetchPublicView(token: string): Promise<PublicMapViewDto | null> {
  const response = await fetch(buildPath(routes.public.map.path, { token }), {
    credentials: 'omit',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status >= 500 ? 'internal' : 'bad_request',
      response.statusText,
    );
  }
  return (await response.json()) as PublicMapViewDto;
}
