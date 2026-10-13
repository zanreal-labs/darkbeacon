import type { Kysely } from 'kysely';

/**
 * Every map has the trade hubs as map hubs: new maps get them when created, existing maps gain
 * the ones they lack here, after the hubs they have (a hub a map has is never doubled), up to 20
 * hubs. A copy of `DEFAULT_MAP_HUBS` from `@darkbeacon/routing` as it was when this ran:
 * migrations do not change when the defaults do. Jita, Amarr, Dodixie, Rens, Hek.
 */
export const DEFAULT_MAP_HUBS = [30000142, 30002187, 30002659, 30002510, 30002053] as const;

const MAX_HUBS = 20;

interface Tables {
  maps: { id: string };
  routing_map_hubs: { map_id: string; solar_system_id: number; position: number };
}

/** The default hubs a map with these hubs lacks, in order, as many as there is room for. */
export function missingDefaultHubs(current: readonly number[]): number[] {
  const has = new Set(current);
  const room = Math.max(0, MAX_HUBS - has.size);
  return DEFAULT_MAP_HUBS.filter((id) => !has.has(id)).slice(0, room);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const k = db as unknown as Kysely<Tables>;
  const maps = await k.selectFrom('maps').select('id').execute();
  const rows = await k
    .selectFrom('routing_map_hubs')
    .select(['map_id', 'solar_system_id', 'position'])
    .execute();
  const byMap = new Map<string, { ids: number[]; last: number }>();
  for (const row of rows) {
    const entry = byMap.get(row.map_id) ?? { ids: [], last: -1 };
    entry.ids.push(Number(row.solar_system_id));
    entry.last = Math.max(entry.last, Number(row.position));
    byMap.set(row.map_id, entry);
  }
  for (const map of maps) {
    const { ids, last } = byMap.get(map.id) ?? { ids: [], last: -1 };
    const missing = missingDefaultHubs(ids);
    if (missing.length === 0) continue;
    await k
      .insertInto('routing_map_hubs')
      .values(missing.map((id, i) => ({ map_id: map.id, solar_system_id: id, position: last + 1 + i })))
      .execute();
  }
}

/** The hubs stay: by now people may have kept or removed them on purpose. */
export async function down(): Promise<void> {}
