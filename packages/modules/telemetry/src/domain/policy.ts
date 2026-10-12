import type { TelemetryOffReason } from '@darkbeacon/shared';

/** What decides whether an instance reports, apart from the admin switch. */
export interface TelemetryEnvironment {
  /** PostHog project key; empty = inert. */
  key: string;
  env: 'development' | 'production' | 'test';
  /** `env`: TELEMETRY=off; `dnt`: DO_NOT_TRACK=1. */
  optOut: 'env' | 'dnt' | null;
}

/**
 * Why nothing is sent, or null when telemetry is on. Only production servers with a key send,
 * and every opt-out wins: the environment (an operator who never opens the admin tab) before
 * the admin switch.
 */
export function telemetryOffReason(
  environment: TelemetryEnvironment,
  adminEnabled: boolean,
): TelemetryOffReason | null {
  if (!environment.key) return 'no_key';
  if (environment.optOut === 'env') return 'env_opt_out';
  if (environment.optOut === 'dnt') return 'do_not_track';
  if (environment.env !== 'production') return 'not_production';
  if (!adminEnabled) return 'admin_disabled';
  return null;
}

const OFF = new Set(['0', 'off', 'false', 'no', 'disabled']);

/** Reads TELEMETRY and DO_NOT_TRACK (https://consoledonottrack.com: any value but empty or 0). */
export function telemetryOptOut(env: { TELEMETRY?: string; DO_NOT_TRACK?: string }): 'env' | 'dnt' | null {
  const telemetry = env.TELEMETRY?.trim().toLowerCase();
  if (telemetry && OFF.has(telemetry)) return 'env';
  const dnt = env.DO_NOT_TRACK?.trim().toLowerCase();
  if (dnt && dnt !== '0' && dnt !== 'false') return 'dnt';
  return null;
}
