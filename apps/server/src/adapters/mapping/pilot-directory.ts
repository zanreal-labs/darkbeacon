import type { Database } from '@darkbeacon/db';
import type { PilotDirectory } from '@darkbeacon/mapping';

interface PilotTables {
  eve_character: { id: number; name: string };
  character_presence: { character_id: number; name: string };
}

/**
 * Mapping's PilotDirectory over what this instance already knows: linked characters (identity)
 * first, then the last presence tracking kept. Tracked jumps are always by linked characters, so
 * ESI is never asked; a character unlinked since keeps the name tracking saw.
 */
export class KyselyPilotDirectory implements PilotDirectory {
  constructor(private readonly database: Database) {}

  async names(characterIds: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (characterIds.length === 0) return out;
    const db = this.database.db<PilotTables>();
    const ids = [...characterIds];
    const presence = await db
      .selectFrom('character_presence')
      .select(['character_id', 'name'])
      .where('character_id', 'in', ids)
      .execute();
    for (const row of presence) out.set(Number(row.character_id), row.name);
    const linked = await db
      .selectFrom('eve_character')
      .select(['id', 'name'])
      .where('id', 'in', ids)
      .execute();
    for (const row of linked) out.set(Number(row.id), row.name);
    return out;
  }
}
