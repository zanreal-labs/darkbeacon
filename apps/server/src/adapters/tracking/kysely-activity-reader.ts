import { json, type Database } from '@darkbeacon/db';
import { mapStream } from '@darkbeacon/core';
import type { ActivityReader } from '@darkbeacon/tracking';

interface ActivityTables {
  event_log: { stream: string; type: string; occurred_at: number; data: string; audit: string | null };
}

const COUNTED = {
  'character.jumped': 'jumps',
  'system.added': 'systems',
  'connection.added': 'connections',
  'signature.added': 'signatures',
} as const;
type Counter = (typeof COUNTED)[keyof typeof COUNTED];

/** The most rows one statistics request reads; older activity of a very busy map is left out. */
const MAX_ROWS = 200_000;

/**
 * Character activity from a map's event log: jumps by the character the event is about, and
 * additions by the character the audit trail recorded as acting (auto-mapping records the
 * character that jumped; people editing by hand act as their main).
 */
export class KyselyActivityReader implements ActivityReader {
  constructor(private readonly database: Database) {}

  async activity(mapId: string, since: number) {
    const rows = await this.database
      .db<ActivityTables>()
      .selectFrom('event_log')
      .select(['type', 'data', 'audit'])
      .where('stream', '=', mapStream(mapId))
      .where('type', 'in', Object.keys(COUNTED))
      .where('occurred_at', '>=', since)
      .orderBy('occurred_at', 'desc')
      .limit(MAX_ROWS)
      .execute();
    const counts = new Map<number, Record<Counter, number>>();
    for (const row of rows) {
      const counter = COUNTED[row.type as keyof typeof COUNTED];
      const characterId =
        row.type === 'character.jumped'
          ? json.decode<{ characterId?: number }>(row.data)?.characterId
          : json.decode<{ actor?: { characterId?: number | null } }>(row.audit)?.actor?.characterId;
      if (typeof characterId !== 'number') continue;
      let entry = counts.get(characterId);
      if (!entry) counts.set(characterId, (entry = { jumps: 0, systems: 0, connections: 0, signatures: 0 }));
      entry[counter] += 1;
    }
    return [...counts].map(([characterId, c]) => ({ characterId, ...c }));
  }
}
