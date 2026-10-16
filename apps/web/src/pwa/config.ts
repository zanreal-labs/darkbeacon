/**
 * Whether this instance offers the app install (manifest, service worker). On unless `PWA` says
 * off; read at request time, so switching it needs a restart, not a rebuild.
 */
export function pwaEnabled(env: Record<string, string | undefined>): boolean {
  const value = (env.PWA ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'disabled'].includes(value);
}
