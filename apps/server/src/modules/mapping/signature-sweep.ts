import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Leadership } from '@darkbeacon/core';
import { SignatureUseCases } from '@darkbeacon/mapping';
import { AsyncAuditScope } from '../../platform/audit.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { LEADERSHIP } from '../../platform/tokens.js';

const HOUR = 60 * 60 * 1000;

/**
 * Removes old signatures once an hour, as Wanderer does daily: those nobody changed or scanned
 * again for the map's retention (14 days by default). Recorded as the `signature-sweep` process.
 * One replica sweeps (the leader), and none during maintenance.
 */
@Injectable()
export class SignatureSweep implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger('SignatureSweep');

  constructor(
    @Inject(SignatureUseCases) private readonly signatures: SignatureUseCases,
    @Inject(AsyncAuditScope) private readonly audit: AsyncAuditScope,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.leadership.isLeader() && !this.maintenance.active) void this.run();
    }, HOUR).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      const removed = await this.audit.run(
        { channel: { kind: 'system', id: 'signature-sweep' }, origin: undefined },
        () => this.signatures.sweep(),
      );
      if (removed > 0) this.logger.log(`removed ${removed} old signature(s)`);
      return removed;
    } catch (error) {
      this.logger.error(`sweep failed: ${String(error)}`);
      return 0;
    }
  }
}
