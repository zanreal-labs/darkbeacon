import type { DomainEvent } from '../events.js';

export interface EventFilter {
  stream?: string;
  /** Exact types, or a prefix ending with `.*` such as `system.*`. */
  types?: readonly string[];
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Fan-out of committed events. In-process today; the interface allows a Postgres
 * LISTEN/NOTIFY implementation later. Handlers run asynchronously and in isolation.
 */
export interface EventBus {
  publish(events: readonly DomainEvent[]): void;
  subscribe(handler: EventHandler, filter?: EventFilter): () => void;
}

export function matchesFilter(event: DomainEvent, filter?: EventFilter): boolean {
  if (!filter) return true;
  if (filter.stream !== undefined && filter.stream !== event.stream) return false;
  if (!filter.types) return true;
  return filter.types.some((t) =>
    t.endsWith('.*') ? event.type.startsWith(t.slice(0, -1)) : t === '*' || t === event.type,
  );
}
