/**
 * Next.js instrumentation hook (https://nextjs.org/docs/app/guides/open-telemetry): starts
 * OpenTelemetry tracing in the Node.js server when the environment turns it on. The API server
 * that starts this app passes `OTEL_ENABLED` (or `OTEL_SDK_DISABLED`) down; `next dev` on its own
 * follows the same variables. While it is off the SDK is never imported.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !telemetryOn(process.env)) return;
  await import('./instrumentation.node');
}

/** The API server's rule: on with OTEL_ENABLED=true or an OTLP endpoint, off with OTEL_SDK_DISABLED. */
export function telemetryOn(env: NodeJS.ProcessEnv): boolean {
  const flag = (name: string) => env[name]?.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(flag('OTEL_SDK_DISABLED') ?? '')) return false;
  const enabled = flag('OTEL_ENABLED');
  if (enabled !== undefined && enabled !== '') return ['true', '1', 'yes'].includes(enabled);
  return ['', '_TRACES'].some((signal) => !!env[`OTEL_EXPORTER_OTLP${signal}_ENDPOINT`]?.trim());
}
