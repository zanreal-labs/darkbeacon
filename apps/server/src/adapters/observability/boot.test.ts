import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootTelemetry, type SdkLoader } from './boot.js';
import { setTelemetryRuntime, stoppedRuntime, telemetryRuntime, webTelemetryEnv } from './runtime.js';
import { parseTelemetrySettings } from '@darkbeacon/observability';

afterEach(() => setTelemetryRuntime(null));

function fakeLoader() {
  const startOtel = vi.fn(async (settings: Parameters<Awaited<ReturnType<SdkLoader>>['startOtel']>[0]) => ({
    ...stoppedRuntime(settings),
    running: true,
  }));
  const load = vi.fn(async () => ({ startOtel }));
  return { load, startOtel };
}

describe('telemetry boot', () => {
  it('does not load the SDK while telemetry is off', async () => {
    const { load } = fakeLoader();
    expect(await bootTelemetry({}, load)).toBeNull();
    expect(await bootTelemetry({ OTEL_SDK_DISABLED: 'true', OTEL_ENABLED: 'true' }, load)).toBeNull();
    expect(
      await bootTelemetry({ OTEL_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' }, load),
    ).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(telemetryRuntime().running).toBe(false);
  });

  it('does not load the SDK with invalid settings (the server refuses to start instead)', async () => {
    const { load } = fakeLoader();
    expect(await bootTelemetry({ METRICS_PROMETHEUS: 'true' }, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('starts the SDK when an endpoint is set and installs the runtime', async () => {
    const { load, startOtel } = fakeLoader();
    const runtime = await bootTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://lgtm:4318' }, load);
    expect(load).toHaveBeenCalledOnce();
    expect(startOtel.mock.calls[0]![0]).toMatchObject({ enabled: true, endpointHost: 'lgtm:4318' });
    expect(telemetryRuntime()).toBe(runtime);
  });

  it('keeps the instance starting when the SDK fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load: SdkLoader = async () => ({
      startOtel: async () => {
        throw new Error('boom');
      },
    });
    expect(await bootTelemetry({ OTEL_ENABLED: 'true' }, load)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the off path free of SDK imports', () => {
    // What the preload loads before it knows whether telemetry is on.
    for (const file of ['./preload.ts', './boot.ts', './runtime.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      expect(imports.filter((i) => i!.startsWith('@opentelemetry/') || i === 'import-in-the-middle')).toEqual(
        [],
      );
    }
  });

  it('gives the web server traces only, or nothing', () => {
    const on = {
      ...stoppedRuntime(parseTelemetrySettings({ OTEL_ENABLED: 'true' }).settings),
      running: true,
    };
    expect(webTelemetryEnv(on)).toEqual({
      OTEL_ENABLED: 'true',
      OTEL_SERVICE_NAME: 'darkbeacon-web',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    });
    expect(webTelemetryEnv(stoppedRuntime(parseTelemetrySettings({}).settings))).toEqual({
      OTEL_SDK_DISABLED: 'true',
    });
  });
});
