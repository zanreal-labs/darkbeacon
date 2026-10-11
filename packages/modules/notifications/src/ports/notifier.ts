import type { Notification } from '../domain/notification.js';

/** A delivery channel. Plugins can provide one (same shape as plugin-sdk's Notifier). */
export interface Notifier {
  readonly id: string;
  send(notification: Notification): Promise<void>;
}
