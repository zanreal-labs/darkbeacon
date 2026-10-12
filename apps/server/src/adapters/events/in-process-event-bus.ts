import {
  matchesFilter,
  type DomainEvent,
  type EventBus,
  type EventFilter,
  type EventHandler,
} from '@darkbeacon/core';

type ErrorReporter = (error: unknown, event: DomainEvent) => void;

/** EventBus for a single process. Each handler runs asynchronously; a failing handler affects nobody else. */
export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Set<{ handler: EventHandler; filter: EventFilter | undefined }>();

  constructor(
    private readonly reportError: ErrorReporter = (error, event) =>
      console.error(`event handler failed for ${event.type} (${event.id})`, error),
    /**
     * Runs the dispatch outside the publisher's async context, so handlers do not inherit the
     * request that committed the event (its audit facts belong to that request only).
     */
    private readonly detach: (dispatch: () => void) => void = (dispatch) => dispatch(),
  ) {}

  publish(events: readonly DomainEvent[]): void {
    this.detach(() => {
      for (const event of events) {
        for (const sub of this.subscriptions) {
          if (!matchesFilter(event, sub.filter)) continue;
          Promise.resolve()
            .then(() => sub.handler(event))
            .catch((error: unknown) => this.reportError(error, event));
        }
      }
    });
  }

  subscribe(handler: EventHandler, filter?: EventFilter): () => void {
    const sub = { handler, filter };
    this.subscriptions.add(sub);
    return () => this.subscriptions.delete(sub);
  }
}
