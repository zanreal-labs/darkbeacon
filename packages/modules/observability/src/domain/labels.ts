/**
 * Metric attributes stay low-cardinality: route templates instead of URLs, a short list of
 * channel names, no character, account or map ids anywhere.
 */

const ESI_HOST = 'esi.evetech.net';

/**
 * The route template of an ESI request (`/characters/{id}/location`), or null when the URL is
 * not ESI. Ids and the optional version prefix (`/latest`, `/v5`) are folded away; the query
 * string is dropped.
 */
export function esiRoute(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== ESI_HOST) return null;
  const path = parsed.pathname
    .replace(/^\/(latest|legacy|dev|v\d+)(?=\/)/, '')
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    .replace(/\/+$/, '');
  return path || '/';
}

const CHANNEL = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A notification channel name as a label (`webhook`, `discord`...), `other` for anything odd. */
export function channelLabel(channel: string): string {
  const name = channel.trim().toLowerCase();
  return CHANNEL.test(name) ? name : 'other';
}

/** HTTP status class for labels: `2xx`, `3xx`, `4xx`, `5xx`. */
export function statusClass(status: number): string {
  return `${Math.min(Math.max(Math.floor(status / 100), 1), 5)}xx`;
}
