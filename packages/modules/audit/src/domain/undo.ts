import { asFields } from './diff.js';
import type { StoredEvent } from './entries.js';

/** Fields of a connection a renumbering writes by itself after other changes. */
const NUMBER_FIELDS = new Set(['bookmarkNumber', 'bookmarkParent']);

/** Things put back first: a system before its connections, a connection before its signatures. */
const RESTORE_ORDER: Record<string, number> = {
  'system.removed': 0,
  'connection.removed': 1,
  'signature.removed': 2,
};

const entityKey = (stored: StoredEvent): string | null => {
  const entity = stored.audit?.entity;
  return entity ? `${entity.kind}:${entity.id}` : null;
};

/** The system a signature event is about (signature events carry it in their data). */
const systemOf = (stored: StoredEvent): number | null => {
  const id = asFields(stored.event.data)?.solarSystemId;
  return typeof id === 'number' ? id : null;
};

/**
 * Which changes of one gesture to revert, and in which order, so the map ends up as before it:
 *
 * - Removals are put back first (systems, then connections, then signatures), so a connection
 *   finds both of its systems and a signature finds the connection it led through.
 * - Everything else goes newest first.
 * - What follows from another change of the gesture is left to it: a change to something the
 *   gesture added (undoing the add takes it away), the signatures a restored system brought back
 *   with it, and the renumbering of bookmarks that follows any change of the chain.
 *
 * `events` are the gesture's changes in any order; reverted ones are already left out.
 */
export function undoPlan(events: readonly StoredEvent[]): StoredEvent[] {
  const added = new Set(
    events
      .filter((s) => s.event.type.endsWith('.added'))
      .map(entityKey)
      .filter((k): k is string => k !== null),
  );
  const systemsAdded = new Set(
    events.filter((s) => s.event.type === 'system.added').map((s) => s.audit?.entity?.id),
  );
  const keep = events.filter((stored) => {
    const { type } = stored.event;
    if (type.endsWith('.updated')) {
      const key = entityKey(stored);
      if (key && added.has(key)) return false;
    }
    if (type === 'signature.added') {
      const system = systemOf(stored);
      if (system !== null && systemsAdded.has(String(system))) return false;
    }
    if (type === 'connection.updated' && events.length > 1) {
      const fields = Object.keys(stored.audit?.diff ?? {});
      if (fields.length > 0 && fields.every((f) => NUMBER_FIELDS.has(f))) return false;
    }
    return true;
  });
  const newestFirst = (a: StoredEvent, b: StoredEvent) =>
    b.event.occurredAt - a.event.occurredAt || b.event.seq - a.event.seq;
  return [...keep].sort((a, b) => {
    const ra = RESTORE_ORDER[a.event.type] ?? 9;
    const rb = RESTORE_ORDER[b.event.type] ?? 9;
    return ra - rb || newestFirst(a, b);
  });
}
