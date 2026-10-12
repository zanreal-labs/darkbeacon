import { parseTelemetrySettings, type Env, type TelemetrySettings } from '@darkbeacon/observability';
import { setTelemetryRuntime, type TelemetryRuntime } from './runtime.js';

/** Loads the SDK adapter; replaceable in tests. */
export type SdkLoader = () => Promise<{ startOtel(settings: TelemetrySettings): Promise<TelemetryRuntime> }>;

const loadSdk: SdkLoader = () => import('./otel-sdk.js');

/**
 * Starts telemetry when the environment asks for it, before the application is imported (so
 * the instrumentations see `http`, `pg`, `fastify` and Nest load). While it is off the SDK is
 * never imported. Invalid settings start nothing: the server then refuses to start and lists them.
 */
export async function bootTelemetry(env: Env, load: SdkLoader = loadSdk): Promise<TelemetryRuntime | null> {
  const { settings, problems } = parseTelemetrySettings(env);
  if (problems.length > 0 || !settings.enabled) return null;
  try {
    const runtime = await (await load()).startOtel(settings);
    setTelemetryRuntime(runtime);
    return runtime;
  } catch (error) {
    // Monitoring must never keep the instance from starting.
    console.error('OpenTelemetry did not start:', error);
    return null;
  }
}
