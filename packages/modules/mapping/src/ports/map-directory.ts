import type { Actor } from '@darkbeacon/core';

/**
 * What mapping needs from the rest of the instance for the life of a map: account names (a new
 * owner must exist; the inventory shows owners), the instance policy on creating maps, and how
 * many access rules each map has. Composed in the server from identity and access.
 */
export interface MapDirectory {
  /** Names of the accounts that exist among `accountIds`. */
  accountNames(accountIds: readonly string[]): Promise<Map<string, string>>;
  /** May this actor create maps (the instance's "only admins create maps" setting)? */
  mayCreateMaps(actor: Actor): Promise<boolean>;
  accessRuleCounts(): Promise<Map<string, number>>;
}
