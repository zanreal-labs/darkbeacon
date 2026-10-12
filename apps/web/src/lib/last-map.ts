/** The map someone opened last; `/` sends them back to it. Only ever a map slug, never trusted beyond that. */
export const LAST_MAP_COOKIE = 'dbk_last_map';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isMapSlug(value: string | undefined): value is string {
  return value !== undefined && SLUG.test(value);
}

/** Remembers the open map for a year. Called from the map page in the browser. */
export function rememberLastMap(slug: string): void {
  if (!isMapSlug(slug)) return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LAST_MAP_COOKIE}=${slug}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
