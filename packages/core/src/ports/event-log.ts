import type { DomainEvent, NewEvent } from '../events.js';

/** Append-only outbox (`event_log`). The source of truth for replay and the realtime feed. */
export interface EventLog {
  /**
   * Appends events inside the current UnitOfWork transaction (opens one when called outside).
   * Assigns per-stream `seq` and publishes the events on the EventBus after commit.
   */
  append(events: readonly NewEvent[]): Promise<DomainEvent[]>;
  /** Events with seq > sinceSeq, ascending. */
  readSince(stream: string, sinceSeq: number, limit?: number): Promise<DomainEvent[]>;
  /** Last assigned seq of the stream, 0 when empty. Survives pruning. */
  headSeq(stream: string): Promise<number>;
  /** Lowest seq still stored for the stream, or null when nothing is stored. */
  oldestSeq(stream: string): Promise<number | null>;
  /** Deletes events that occurred before `before` (epoch ms). Returns the number removed. */
  prune(before: number): Promise<number>;
}
