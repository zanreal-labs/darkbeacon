const BASE = 'http://darkbeacon.invalid';

/**
 * Only paths on this site, so a crafted link cannot send people elsewhere after sign-in. The path
 * is resolved the way browsers do (a backslash reads as a slash, tabs and newlines are dropped)
 * and kept only when it stays on the same origin; backslashes and control characters are refused
 * outright. Answers the normalised path (with query and hash), or `/`.
 */
export function safeNext(next: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/';
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  const path = url.pathname + url.search + url.hash;
  // `//host` survives as a path only when the input spelled it out; never hand that back.
  return path.startsWith('//') ? '/' : path;
}
