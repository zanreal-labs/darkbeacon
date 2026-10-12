import { Injectable, Logger } from '@nestjs/common';
import type { AuditContext, NewEvent } from '@darkbeacon/core';

/** Sees every committed event as written (with `before`) and the audit facts it was written under. */
export type EventTap = (events: readonly NewEvent[], context: AuditContext) => void;

/**
 * Observers of the event log after commit, for read-only consumers that need more than the
 * bus envelope (such as how a change was made). Taps run synchronously after the commit, so
 * they must be cheap and must not write; one that throws is logged and affects nobody else.
 */
@Injectable()
export class EventLogTaps {
  private readonly taps = new Set<EventTap>();
  private readonly logger = new Logger('EventLogTaps');

  add(tap: EventTap): () => void {
    this.taps.add(tap);
    return () => this.taps.delete(tap);
  }

  notify(events: readonly NewEvent[], context: AuditContext): void {
    for (const tap of this.taps) {
      try {
        tap(events, context);
      } catch (error) {
        this.logger.error(`tap failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
