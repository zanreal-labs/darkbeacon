/**
 * The maintainers' PostHog project, baked into builds. The one place to set it: a `phc_` project
 * API key (write-only, safe to ship) and the ingestion host of its region. While the key is empty
 * telemetry is inert everywhere unless an instance sets TELEMETRY_POSTHOG_KEY itself.
 */
export const DEFAULT_TELEMETRY_KEY = '';
export const DEFAULT_TELEMETRY_HOST = 'https://eu.i.posthog.com';
