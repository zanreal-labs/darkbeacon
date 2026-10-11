import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Clock, EventLog } from '@wormwright/core';
import { CLOCK, EVENT_LOG } from '../platform/tokens.js';

const DAY = 24 * 60 * 60 * 1000;
/** Default event_log retention; becomes an admin setting later. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Prunes old events from the log once an hour. */
@Injectable()
export class EventRetention implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger('EventRetention');

  constructor(
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.prune(), 60 * 60 * 1000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async prune(days = DEFAULT_RETENTION_DAYS): Promise<number> {
    try {
      const removed = await this.log.prune(this.clock.now() - days * DAY);
      if (removed > 0) this.logger.log(`pruned ${removed} events older than ${days} days`);
      return removed;
    } catch (error) {
      this.logger.error(`pruning failed: ${String(error)}`);
      return 0;
    }
  }
}
