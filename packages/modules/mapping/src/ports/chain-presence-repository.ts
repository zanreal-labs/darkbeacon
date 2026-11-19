import type { ChainPresence } from '../domain/chain-presence.js';

/** When each system was last in a map's chain from home (deleted with the map). */
export interface ChainPresenceRepository {
  /** Every system the map's chain ever held. */
  list(mapId: string): Promise<ChainPresence[]>;
  /** Inserts or replaces these rows. */
  put(rows: readonly ChainPresence[]): Promise<void>;
  /** Whether the map holds any row yet (a map without one was never recorded). */
  any(mapId: string): Promise<boolean>;
}
