import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';

/**
 * Every map gets the default Tags (the coloured markers stored in `maps.labels`): new maps are
 * created with them, existing maps gain the ones they lack here. A Tag the map has by name (in any
 * case) is left exactly as it is, colour, description and id; missing ones are added at the end,
 * with the fixed id unless the map already uses it. Maps keep at most 64 Tags. A copy of
 * `DEFAULT_TAGS` from `@darkbeacon/shared` as it was when this ran: migrations do not change when
 * the defaults do. Numbered after `mapping/0500_connection_ends`, so it sorts after migrations that
 * already ran.
 */
export const DEFAULT_TAGS = [
  {
    id: 'staging',
    name: 'Staging',
    color: '#5a9bbd',
    description: 'Where the fleet forms up and ships wait.',
  },
  {
    id: 'sites',
    name: 'Sites',
    color: '#6a9f5b',
    description: 'Combat, relic, data or gas sites worth running.',
  },
  {
    id: 'hostile',
    name: 'Hostile',
    color: '#c45c5c',
    description: 'Hostiles live or were seen here. Scout first.',
  },
  { id: 'exit', name: 'Exit', color: '#8a93a3', description: 'A way out to known space.' },
  { id: 'home', name: 'Home', color: '#4ea39a', description: 'Our home hole.' },
  { id: 'farm', name: 'Farm', color: '#c3994a', description: 'A system we farm regularly.' },
  { id: 'fleet', name: 'Fleet', color: '#9583cc', description: 'Our fleet is here or heading here.' },
] as const;

const MAX_TAGS = 64;

interface Tag {
  id: string;
  name: string;
  color: string;
  description?: string;
}

interface Tables {
  maps: { id: string; labels: string };
}

/** The map's Tags with the missing defaults added, or null when nothing is missing. */
export function withDefaultTags(tags: readonly Tag[]): Tag[] | null {
  const names = new Set(tags.map((t) => t.name.trim().toLowerCase()));
  const ids = new Set(tags.map((t) => t.id));
  const next = [...tags];
  for (const tag of DEFAULT_TAGS) {
    if (next.length >= MAX_TAGS) break;
    if (names.has(tag.name.toLowerCase())) continue;
    const id = ids.has(tag.id) ? randomUUID() : tag.id;
    names.add(tag.name.toLowerCase());
    ids.add(id);
    next.push({ ...tag, id });
  }
  return next.length === tags.length ? null : next;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const k = db as unknown as Kysely<Tables>;
  const maps = await k.selectFrom('maps').select(['id', 'labels']).execute();
  for (const map of maps) {
    let tags: unknown;
    try {
      tags = JSON.parse(map.labels);
    } catch {
      continue; // Never replace what cannot be read.
    }
    if (!Array.isArray(tags)) continue;
    const next = withDefaultTags(tags as Tag[]);
    if (!next) continue;
    await k
      .updateTable('maps')
      .set({ labels: JSON.stringify(next) })
      .where('id', '=', map.id)
      .execute();
  }
}

/** The defaults stay: by now people may have tagged systems with them. */
export async function down(): Promise<void> {}
