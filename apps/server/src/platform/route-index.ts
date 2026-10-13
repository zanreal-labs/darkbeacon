import { API_V1_PREFIX, routes, type RouteDef } from '@darkbeacon/shared';

/** Every route of `routes.ts`, by `METHOD /api/path/:param` (the pattern Fastify matched). */
function index(): Map<string, RouteDef> {
  const byKey = new Map<string, RouteDef>();
  for (const defs of Object.values(routes)) {
    const list: RouteDef[] =
      'method' in defs ? [defs as RouteDef] : Object.values(defs as Record<string, RouteDef>);
    for (const route of list) byKey.set(`${route.method} ${route.path}`, route);
  }
  return byKey;
}

const ROUTES = index();

/** The contract entry of the route Fastify matched, or undefined (plugin routes, unknown paths). */
export function routeFor(method: string, pattern: string | undefined): RouteDef | undefined {
  return pattern ? ROUTES.get(`${method.toUpperCase()} ${pattern}`) : undefined;
}

/** `/api/v1/...` is the stable alias of `/api/...` (see the versioning policy in docs/api.md). */
export function rewriteVersionedUrl(url: string): string {
  if (url === API_V1_PREFIX || url.startsWith(`${API_V1_PREFIX}/`) || url.startsWith(`${API_V1_PREFIX}?`))
    return `/api${url.slice(API_V1_PREFIX.length)}`;
  return url;
}
