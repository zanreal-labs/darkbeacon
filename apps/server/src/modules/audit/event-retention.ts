import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Clock, EventLog } from '@darkbeacon/core';
import { CLOCK, EVENT_LOG } from '../../platform/tokens.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Prunes the event log once an hour when the instance has a retention (`eventRetentionDays`).
 * By default there is none: the log is the audit trail and keeps everything. Replay and webhook
 * delivery only read recent events, so pruning old ones never affects them.
 */
@Injectable()
export class EventRetention implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger('EventRetention');

  constructor(
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.prune(), 60 * 60 * 1000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Removes events older than the retention; `days` overrides the setting (tests). */
  async prune(days?: number | null): Promise<number> {
    try {
      const keep = days === undefined ? (await this.settings.current()).eventRetentionDays : days;
      if (keep === null) return 0;
      const removed = await this.log.prune(this.clock.now() - keep * DAY);
      if (removed > 0) this.logger.log(`pruned ${removed} events older than ${keep} days`);
      return removed;
    } catch (error) {
      this.logger.error(`pruning failed: ${String(error)}`);
      return 0;
    }
  }
}
