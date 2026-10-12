import { requireInstanceRole, type Actor } from '@darkbeacon/core';
import type { ObservabilityDto } from '@darkbeacon/shared';
import type { TelemetrySettings } from '../domain/settings.js';
import { observabilityStatus } from '../domain/status.js';

/** What the admin tab shows about telemetry (instance admins only). */
export class ObservabilityStatusService {
  constructor(
    private readonly deps: {
      settings: TelemetrySettings;
      /** Whether telemetry actually started in this process. */
      running: () => boolean;
    },
  ) {}

  status(actor: Actor | null): ObservabilityDto {
    requireInstanceRole(actor, 'admin');
    return observabilityStatus(this.deps.settings, this.deps.running());
  }
}
