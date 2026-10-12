import { DEFAULT_TELEMETRY_HOST, DEFAULT_TELEMETRY_KEY, telemetryOptOut } from '@darkbeacon/telemetry';

export interface TelemetrySettings {
  /** PostHog project key; empty = inert. */
  key: string;
  host: string;
  optOut: 'env' | 'dnt' | null;
  /** Set when TELEMETRY_POSTHOG_HOST was not a usable URL (telemetry is then inert). */
  problem: string | null;
}

/**
 * Telemetry's own environment, read here so the module comes and goes without the core
 * configuration knowing about it: TELEMETRY, DO_NOT_TRACK, TELEMETRY_POSTHOG_KEY and
 * TELEMETRY_POSTHOG_HOST (defaults: the key and host baked into the build).
 */
export function telemetrySettings(env: NodeJS.ProcessEnv): TelemetrySettings {
  const key = env.TELEMETRY_POSTHOG_KEY?.trim() || DEFAULT_TELEMETRY_KEY;
  const rawHost = env.TELEMETRY_POSTHOG_HOST?.trim() || DEFAULT_TELEMETRY_HOST;
  const optOut = telemetryOptOut(env);
  try {
    const url = new URL(rawHost);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not http(s)');
    return { key, host: rawHost.replace(/\/+$/, ''), optOut, problem: null };
  } catch {
    return {
      key: '',
      host: rawHost,
      optOut,
      problem: `TELEMETRY_POSTHOG_HOST is not a URL (${rawHost}); telemetry is off`,
    };
  }
}
