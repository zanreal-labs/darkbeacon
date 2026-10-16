/**
 * Every address the site prints comes from here, so moving domains is one change.
 *
 * SITE_URL: where this site is served (canonical, sitemap, robots, Open Graph):
 * https://darkbeacon.space. PUBLIC_SITE_URL overrides it, e.g. for a preview deployment.
 *
 * APP_URL: the hosted instance, https://app.darkbeacon.space. Every link into the app uses it;
 * PUBLIC_APP_URL overrides it.
 */
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

const trim = (url: string) => url.replace(/\/+$/, '');

export const SITE_URL = trim(env.PUBLIC_SITE_URL || 'https://darkbeacon.space');

export const APP_URL = trim(env.PUBLIC_APP_URL || 'https://app.darkbeacon.space');

// Not used on the site yet: while there is no separate demo instance, "Try the demo" would open the
// same place as "Open app", so the site shows only "Open app". When a demo instance runs
// (DEMO_MODE=true, read-only data reset on a schedule, e.g. https://demo.<domain>), set
// PUBLIC_DEMO_URL and add the button back.
export const DEMO_URL = trim(env.PUBLIC_DEMO_URL || APP_URL);

export const REPO_URL = 'https://github.com/zanreal-labs/darkbeacon';

/** The install steps in the README: where "Self-host" buttons go. */
export const SELF_HOST_URL = `${REPO_URL}#readme`;

/** Where pilots report problems outside the app (inside it: Help, Report a problem). */
export const ISSUES_URL = `${REPO_URL}/issues`;

/** The company that makes Darkbeacon. */
export const COMPANY_URL = 'https://zanreal.com';

/** The in-game character that receives ISK donations, and its id (ESI /universe/ids/). */
export const DONATION_CHARACTER = 'Z4NR34L';
export const DONATION_CHARACTER_ID = 2121597908;
