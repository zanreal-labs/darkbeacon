import {
  matchesFilter,
  type DomainEvent,
  type EventBus,
  type EventFilter,
  type EventHandler,
} from '@wormwright/core';

type ErrorReporter = (error: unknown, event: DomainEvent) => void;

/** EventBus for a single process. Each handler runs asynchronously; a failing handler affects nobody else. */
export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Set<{ handler: EventHandler; filter: EventFilter | undefined }>();

  constructor(
    private readonly reportError: ErrorReporter = (error, event) =>
      console.error(`event handler failed for ${event.type} (${event.id})`, error),
  ) {}

  publish(events: readonly DomainEvent[]): void {
    for (const event of events) {
      for (const sub of this.subscriptions) {
        if (!matchesFilter(event, sub.filter)) continue;
        Promise.resolve()
          .then(() => sub.handler(event))
          .catch((error: unknown) => this.reportError(error, event));
      }
    }
  }

  subscribe(handler: EventHandler, filter?: EventFilter): () => void {
    const sub = { handler, filter };
    this.subscriptions.add(sub);
    return () => this.subscriptions.delete(sub);
  }
}
