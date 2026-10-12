import type { PassageDto } from '@darkbeacon/shared';
import type { Connection } from '../domain/map.js';
import type { ChainView, FieldTimes, StampedKind } from '../domain/stamps.js';

/**
 * When things on a map changed, for maps that merge this one: per field of every system,
 * connection and signature, and the deletions (tombstones) of connections and signatures.
 * Field times are kept by the repositories on every write; tombstones by the use cases that
 * delete (hiding a system and the connections that go with it is not a deletion).
 */
export interface ChangeStamps {
  /**
   * Field change times of the objects with these ids (solar system ids as strings for systems);
   * every object of that kind on the map when `ids` is omitted. A field missing from the times
   * has not changed since the object was created.
   */
  fieldTimes(mapId: string, kind: StampedKind, ids?: readonly string[]): Promise<Map<string, FieldTimes>>;
  /** Deletion times by key (`<low>-<high>` pairs, `<system>:<code>` signatures); every one when `keys` is omitted. */
  tombstones(
    mapId: string,
    kind: 'connection' | 'signature',
    keys?: readonly string[],
  ): Promise<Map<string, number>>;
  /** Records (or moves forward) the deletion of `key` at `at`. */
  putTombstone(mapId: string, kind: 'connection' | 'signature', key: string, at: number): Promise<void>;
  /** Forgets deletions older than `before`; returns how many. */
  pruneTombstones(before: number): Promise<number>;
}

/**
 * A map whose chain is merged from other maps: the systems, connections and signatures its
 * viewers see instead of its own rows. Provided by the sharing module; null for plain maps.
 */
export interface ChainOverlay {
  view(mapId: string): Promise<ChainView | null>;
  /**
   * Passages of a merged connection, from the sources that share its status (passages stay with
   * the map that recorded them; here they are read-only). Absent: merged maps show none.
   */
  passages?(mapId: string, connection: Connection): Promise<PassageDto[]>;
}
