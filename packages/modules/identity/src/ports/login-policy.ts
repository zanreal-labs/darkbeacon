import type { LoginMethod } from '@darkbeacon/shared';

/**
 * How people sign in on this instance (an instance setting kept by access). Provided by access;
 * identity only asks.
 */
export interface LoginPolicy {
  /** The effective method: `eve` whenever Discord is not configured. */
  loginMethod(): Promise<LoginMethod>;
}
