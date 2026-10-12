import type { ObservabilityDto } from '@darkbeacon/shared';
import { METRICS_PATH, SIGNALS, type TelemetrySettings } from './settings.js';

/** What an admin sees about telemetry: never headers, tokens or the endpoint's path. */
export function observabilityStatus(settings: TelemetrySettings, running: boolean): ObservabilityDto {
  const otlp = SIGNALS.filter((s) => settings.signals[s]?.exporter === 'otlp');
  const first = otlp.length > 0 ? settings.signals[otlp[0]!] : null;
  const live = running && settings.enabled;
  return {
    enabled: live,
    notLoaded: settings.enabled && !running,
    serviceName: settings.serviceName,
    otlp: {
      endpoint: live ? settings.endpointHost : null,
      protocol: live && first?.exporter === 'otlp' ? first.protocol : null,
      signals: live ? otlp : [],
    },
    prometheus: { enabled: live && settings.prometheus !== null, path: METRICS_PATH },
  };
}
