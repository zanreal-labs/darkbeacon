import { ValidationError } from '@darkbeacon/core';

/** The public Wanderer instance. */
export const PUBLIC_WANDERER = 'https://wanderer.ltd';

export interface WandererBase {
  /** `https://wanderer.example.org` (the origin). */
  url: string;
  /** `wanderer.example.org` (with `:port` when not the default), as shown and audited. */
  host: string;
  protocol: 'http:' | 'https:';
  /** The host name alone (no port, no IPv6 brackets), for the private-address check. */
  hostname: string;
}

/**
 * Checks and normalises the address of a Wanderer instance. Only http(s), no user name or
 * password in it, no query or fragment; a path (a map's address pasted) is dropped, since the API
 * lives at the origin. A bare host name gets `https://`. Plain http is refused unless private networks are allowed:
 * it would send the map's API key unencrypted.
 */
export function parseWandererBase(input: string, options: { allowPlainHttp: boolean }): WandererBase {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError(
      'That is not a web address. Use the address of the Wanderer instance, e.g. https://wanderer.ltd',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ValidationError('Use an https:// address for the Wanderer instance');
  if (url.username || url.password)
    throw new ValidationError('Leave the user name and password out of the address; the API key is enough');
  if (url.search || url.hash)
    throw new ValidationError('Use the address of the instance only, without ? or #');
  if (url.protocol === 'http:' && !options.allowPlainHttp)
    throw new ValidationError(
      'Use https://: plain http would send the API key unencrypted (an instance admin can allow private networks for a local Wanderer)',
    );
  // People paste a map's address as often as the instance's; the API lives at the origin.
  return {
    url: `${url.protocol}//${url.host}`,
    host: url.host,
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
  };
}

/**
 * The map's slug as Wanderer uses it in API paths. People paste the map's address
 * (`https://wanderer.ltd/home-chain`) as often as the slug, so the last path segment is taken.
 */
export function parseWandererSlug(input: string): string {
  let slug = input.trim();
  if (/^https?:\/\//i.test(slug)) {
    try {
      slug = new URL(slug).pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      slug = '';
    }
  }
  slug = slug.replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(slug))
    throw new ValidationError(
      'The map slug is the last part of the map address in Wanderer, e.g. home-chain',
    );
  return slug;
}
