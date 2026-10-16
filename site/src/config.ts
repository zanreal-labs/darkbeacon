/**
 * Every address the site prints comes from here, so moving to the final domain is one change.
 *
 * SITE_URL: where this site is served (canonical, sitemap, Open Graph). Set PUBLIC_SITE_URL once
 * the domain exists. Until then, on Vercel, the project's production URL that Vercel passes to the
 * build (VERCEL_PROJECT_PRODUCTION_URL); elsewhere a placeholder.
 *
 * APP_URL: the hosted instance. Every link into the app uses it. When the app moves to
 * app.<domain>, set PUBLIC_APP_URL (or change the default below).
 */
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

const trim = (url: string) => url.replace(/\/+$/, '');

const vercelProduction = env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

export const SITE_URL = trim(env.PUBLIC_SITE_URL || vercelProduction || 'https://darkbeacon.vercel.app');

export const APP_URL = trim(env.PUBLIC_APP_URL || 'https://darkbeacon.zanreal.app');

// TODO: point at a dedicated demo instance (DEMO_MODE=true, read-only data reset on a schedule)
// once one runs, e.g. https://demo.<domain>. Until then the demo button opens the hosted instance.
export const DEMO_URL = trim(env.PUBLIC_DEMO_URL || APP_URL);

export const REPO_URL = 'https://github.com/zanreal-labs/darkbeacon';

/** The in-game character that receives ISK donations. */
export const DONATION_CHARACTER = 'Z4NR34L';
