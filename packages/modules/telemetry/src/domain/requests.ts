import { countBucket, routes, type RouteDef } from '@darkbeacon/shared';
import type { TelemetryServerEventName } from './catalogue.js';

/** A successful API request as the HTTP edge saw it: the route pattern, its input and answer. */
export interface ObservedRequest {
  method: string;
  /** The route's pattern, e.g. `/api/maps/:mapId/route`. */
  path: string;
  query: unknown;
  body: unknown;
  response: unknown;
}

export interface RequestFeature {
  event: TelemetryServerEventName;
  props: Record<string, unknown>;
}

type Reader = (request: ObservedRequest) => RequestFeature | null;

const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const count = (value: unknown) => countBucket(typeof value === 'number' ? value : 0);

const READERS: ReadonlyArray<[RouteDef, Reader]> = [
  [
    routes.routing.route,
    ({ query }) => ({
      event: 'route_computed',
      props: {
        mode: field(query, 'mode') ?? 'shortest',
        skips: present(field(query, 'skip')),
        avoids: present(field(query, 'avoid')),
      },
    }),
  ],
  [
    routes.jumps.plan,
    ({ response }) => {
      const legs = field(field(response, 'route'), 'legs');
      return {
        event: 'jump_planned',
        props: {
          hull: field(field(response, 'ship'), 'hull'),
          legs: count(Array.isArray(legs) ? legs.length : 0),
        },
      };
    },
  ],
  [
    routes.routing.waypoint,
    ({ body }) => ({ event: 'waypoint_set', props: { mode: field(body, 'mode') ?? 'destination' } }),
  ],
  [
    routes.eve.search,
    ({ query, response }) => ({
      event: 'esi_picker_used',
      props: { category: field(query, 'category'), mode: field(response, 'mode') },
    }),
  ],
  [
    routes.signatures.paste,
    ({ response }) => ({
      event: 'signatures_pasted',
      props: {
        added: count(field(response, 'added')),
        updated: count(field(response, 'updated')),
        removed: count(field(response, 'removed')),
      },
    }),
  ],
  [routes.maps.setBookmarkTemplate, () => ({ event: 'bookmark_template_changed', props: { scope: 'map' } })],
  [
    routes.maps.updatePreferences,
    ({ body }) =>
      field(body, 'bookmarkTemplate') === undefined
        ? null
        : { event: 'bookmark_template_changed', props: { scope: 'personal' } },
  ],
];

/** Routes whose use is reported, as `METHOD path` keys (the HTTP edge only watches these). */
export const OBSERVED_ROUTES: ReadonlySet<string> = new Set(READERS.map(([r]) => `${r.method} ${r.path}`));

/**
 * The feature a successful request stands for, from its route and enum-like inputs only. The
 * values still go through the allow-list, so an unexpected input is dropped there.
 */
export function requestFeature(request: ObservedRequest): RequestFeature | null {
  const reader = READERS.find(([r]) => r.method === request.method && r.path === request.path)?.[1];
  return reader ? reader(request) : null;
}
