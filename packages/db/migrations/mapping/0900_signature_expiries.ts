import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Tombstones say why a signature went: `reason` `expired` when the sweeper let it expire (lazy
 * delete, retention), with `expired_from`, the moment its time counted from (it was last seen or
 * changed then). An import brings an expired signature back when its source saw it after that
 * moment; a deletion on purpose (null reason) holds until the source changes the signature.
 *
 * The sweepers' removals made before this are marked from the event log: each `signature.removed`
 * of `system:sweeper` (lazy delete, 24 h) or `system:signature-sweep` (retention, the map's days,
 * 14 by default) whose tombstone was not moved since. Their `expired_from` is the latest moment
 * the signature could have been seen and still be due (deletion time minus the period), so a
 * source that saw it later brings it back. Hidden systems' signatures went without an event and
 * stay as they are. Numbered after `0800_systems_on_grid`, because Kysely refuses migrations that
 * sort before ones already run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema.alterTable('map_tombstones').addColumn('reason', col.text).execute();
  await db.schema.alterTable('map_tombstones').addColumn('expired_from', col.timestamp).execute();
  await markExpiries(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_tombstones').dropColumn('expired_from').execute();
  await db.schema.alterTable('map_tombstones').dropColumn('reason').execute();
}

const HOUR = 60 * 60 * 1000;
/** `SIGNATURE_LAZY_DELETE_HOURS` and `DEFAULT_SIGNATURE_RETENTION_DAYS` as they were. */
const LAZY_DELETE_MS = 24 * HOUR;
const DEFAULT_RETENTION_DAYS = 14;

interface Tables {
  event_log: {
    stream: string;
    type: string;
    occurred_at: number | string;
    actor_kind: string;
    actor_id: string;
    data: string;
    audit: string | null;
  };
  map_tombstones: {
    map_id: string;
    kind: string;
    key: string;
    deleted_at: number | string;
    reason: string | null;
    expired_from: number | string | null;
  };
  maps: { id: string; settings: string };
}

/** Marks the tombstones the sweepers left as expiries; returns how many. */
export async function markExpiries(db: Kysely<unknown>): Promise<number> {
  const k = db as unknown as Kysely<Tables>;
  const removals = await k
    .selectFrom('event_log')
    .select(['stream', 'occurred_at', 'actor_id', 'data', 'audit'])
    .where('type', '=', 'signature.removed')
    .where('actor_kind', '=', 'system')
    .where('actor_id', 'in', ['sweeper', 'signature-sweep'])
    .execute();
  const retention = new Map<string, number>();
  const retentionOf = async (mapId: string) => {
    if (!retention.has(mapId)) {
      const map = await k.selectFrom('maps').select('settings').where('id', '=', mapId).executeTakeFirst();
      const days = (parse(map?.settings) as { signatureRetentionDays?: unknown } | null)
        ?.signatureRetentionDays;
      retention.set(mapId, typeof days === 'number' && days > 0 ? days : DEFAULT_RETENTION_DAYS);
    }
    return retention.get(mapId)!;
  };
  let marked = 0;
  for (const removal of removals) {
    if (!removal.stream.startsWith('map:')) continue;
    const mapId = removal.stream.slice('map:'.length);
    // The removed signature's code is in the audit snapshot; the event names only its system.
    const removed = (parse(removal.audit) as { removed?: Record<string, unknown> | null } | null)?.removed;
    const data = parse(removal.data) as Record<string, unknown> | null;
    const eveId = removed?.eveId;
    const solarSystemId = removed?.solarSystemId ?? data?.solarSystemId;
    if (typeof eveId !== 'string' || typeof solarSystemId !== 'number') continue;
    const at = Number(removal.occurred_at);
    const period = removal.actor_id === 'sweeper' ? LAZY_DELETE_MS : (await retentionOf(mapId)) * 24 * HOUR;
    const result = await k
      .updateTable('map_tombstones')
      .set({ reason: 'expired', expired_from: at - period })
      .where('map_id', '=', mapId)
      .where('kind', '=', 'signature')
      .where('key', '=', `${solarSystemId}:${eveId}`)
      .where('reason', 'is', null)
      // Not deleted again since (by someone, which moved the tombstone forward).
      .where('deleted_at', '<=', at)
      .executeTakeFirst();
    marked += Number(result.numUpdatedRows);
  }
  return marked;
}

function parse(text: string | null | undefined): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
