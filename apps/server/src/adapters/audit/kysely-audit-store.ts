import type { AuditCursor, AuditFilter, AuditRecord, AuditStore, StoredEvent } from '@darkbeacon/audit';
import { json, type Database } from '@darkbeacon/db';
import type { AuditStreamCheckDto } from '@darkbeacon/shared';
import type { ExpressionBuilder } from 'kysely';
import { eventHash, fromRow, type EventRow, type EventTables } from '../events/kysely-event-log.js';

type Eb = ExpressionBuilder<EventTables, 'event_log'>;

const VERIFY_PAGE = 1000;

/** Reads `event_log` with its audit records; the queries behind every history. */
export class KyselyAuditStore implements AuditStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<EventTables>();
  }

  async page(filter: AuditFilter, before: AuditCursor | null, limit: number): Promise<StoredEvent[]> {
    let query = this.db
      .selectFrom('event_log')
      .selectAll()
      .where((eb) => eb.or(filter.scopes.map((scope) => eb.and(scopeConditions(eb, scope)))));
    const types = filter.types?.filter((t) => t !== '*') ?? [];
    if (types.length > 0 && types.length === filter.types?.length) {
      query = query.where((eb) =>
        eb.or(
          types.map((t) =>
            t.endsWith('.*') ? eb('type', 'like', `${t.slice(0, -1)}%`) : eb('type', '=', t),
          ),
        ),
      );
    }
    for (const ref of filter.refs ?? []) query = query.where((eb) => hasRef(eb, ref));
    if (filter.since !== undefined) query = query.where('occurred_at', '>=', filter.since);
    if (before) {
      query = query.where((eb) =>
        eb.or([
          eb('occurred_at', '<', before.occurredAt),
          eb.and([eb('occurred_at', '=', before.occurredAt), eb('seq', '<', before.seq)]),
          eb.and([
            eb('occurred_at', '=', before.occurredAt),
            eb('seq', '=', before.seq),
            eb('stream', '<', before.stream),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('occurred_at', 'desc')
      .orderBy('seq', 'desc')
      .orderBy('stream', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toStored);
  }

  async find(eventId: string): Promise<StoredEvent | null> {
    const row = await this.db
      .selectFrom('event_log')
      .selectAll()
      .where('id', '=', eventId)
      .executeTakeFirst();
    return row ? toStored(row) : null;
  }

  async revertsOf(eventIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (eventIds.length === 0) return found;
    const rows = await this.db
      .selectFrom('event_log')
      .select(['id', 'revert_of'])
      .where('revert_of', 'in', [...eventIds])
      .orderBy('occurred_at')
      .orderBy('seq')
      .execute();
    for (const row of rows) if (row.revert_of) found.set(row.revert_of, row.id);
    return found;
  }

  async writtenBy(revertOf: string): Promise<StoredEvent[]> {
    const rows = await this.db
      .selectFrom('event_log')
      .selectAll()
      .where('revert_of', '=', revertOf)
      .orderBy('stream')
      .orderBy('seq')
      .execute();
    return rows.map(toStored);
  }

  async verify(): Promise<AuditStreamCheckDto[]> {
    const streams = await this.db
      .selectFrom('event_stream')
      .select(['stream', 'head_seq', 'head_hash'])
      .orderBy('stream')
      .execute();
    const out: AuditStreamCheckDto[] = [];
    for (const head of streams) out.push(await this.verifyStream(head.stream, head.head_hash));
    return out;
  }

  /**
   * Walks one stream in seq order: every hash must match its row, and every row's `prev_hash`
   * the row before it. The oldest row still stored anchors the chain (retention may have pruned
   * older ones); the newest must be the stream's recorded head.
   */
  private async verifyStream(stream: string, headHash: string | null): Promise<AuditStreamCheckDto> {
    let checked = 0;
    let unchained = 0;
    let previous: string | undefined;
    let after = 0;
    for (;;) {
      const rows = await this.db
        .selectFrom('event_log')
        .selectAll()
        .where('stream', '=', stream)
        .where('seq', '>', after)
        .orderBy('seq')
        .limit(VERIFY_PAGE)
        .execute();
      for (const row of rows) {
        const seq = Number(row.seq);
        after = seq;
        if (row.hash === null) {
          unchained++;
          previous = undefined;
          continue;
        }
        const { hash, ...rest } = row;
        const broken =
          (previous !== undefined && row.prev_hash !== previous) || eventHash({ ...rest, seq }) !== hash;
        if (broken) return { stream, checked, unchained, ok: false, brokenAt: { seq, id: row.id } };
        previous = hash;
        checked++;
      }
      if (rows.length < VERIFY_PAGE) break;
    }
    if (previous !== undefined && headHash !== null && previous !== headHash) {
      // Rows after the last one stored are gone (or the head was rewritten).
      return { stream, checked, unchained, ok: false, brokenAt: { seq: after + 1, id: '' } };
    }
    return { stream, checked, unchained, ok: true, brokenAt: null };
  }
}

function scopeConditions(eb: Eb, scope: AuditFilter['scopes'][number]) {
  const conditions = [];
  if (scope.stream !== undefined) conditions.push(eb('stream', '=', scope.stream));
  if (scope.streamPrefix !== undefined) conditions.push(eb('stream', 'like', `${scope.streamPrefix}%`));
  if (scope.typePrefix !== undefined) conditions.push(eb('type', 'like', `${scope.typePrefix}%`));
  if (scope.ref !== undefined) conditions.push(hasRef(eb, scope.ref));
  return conditions;
}

function hasRef(eb: Eb, ref: string) {
  return eb.exists(
    eb
      .selectFrom('event_ref')
      .select('event_ref.seq')
      .where('event_ref.ref', '=', ref)
      .whereRef('event_ref.stream', '=', 'event_log.stream')
      .whereRef('event_ref.seq', '=', 'event_log.seq'),
  );
}

function toStored(row: EventRow): StoredEvent {
  return { event: fromRow(row), audit: json.decode<AuditRecord>(row.audit) };
}
