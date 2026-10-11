import type { Notification } from '../domain/notification.js';
import type { Notifier } from '../ports/notifier.js';

/**
 * The core Notifier: fans a notification out to every registered channel (plugins provide
 * them). One failing channel never stops the others.
 */
export class NotifierRegistry implements Notifier {
  readonly id = 'core';
  private readonly notifiers = new Set<Notifier>();

  constructor(private readonly onError: (error: unknown, notifier: Notifier) => void = () => undefined) {}

  /** Returns a function that removes the notifier again. */
  add(notifier: Notifier): () => void {
    this.notifiers.add(notifier);
    return () => this.notifiers.delete(notifier);
  }

  ids(): string[] {
    return [...this.notifiers].map((n) => n.id);
  }

  async send(notification: Notification): Promise<void> {
    await Promise.all(
      [...this.notifiers].map(async (notifier) => {
        try {
          await notifier.send(notification);
        } catch (error) {
          this.onError(error, notifier);
        }
      }),
    );
  }
}
