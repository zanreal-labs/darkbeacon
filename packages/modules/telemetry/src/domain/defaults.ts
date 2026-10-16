/**
 * The maintainers' PostHog project, baked into builds. The one place to set it: a `phc_` project
 * API key (write-only, safe to ship) and the host events go to, ZanReal's own proxy in front of
 * PostHog. An instance can send to its own project with TELEMETRY_POSTHOG_KEY and
 * TELEMETRY_POSTHOG_HOST, or opt out (docs/telemetry.md).
 */
export const DEFAULT_TELEMETRY_KEY = 'phc_p6YkK99zADiGD2DqrcShQX5aJNdyAmxLNeAREYm3WXbG';
export const DEFAULT_TELEMETRY_HOST = 'https://g.zanreal.com';
