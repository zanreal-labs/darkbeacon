import { createHash } from 'node:crypto';
import {
  noAuditScope,
  type ActorKind,
  type AuditScope,
  type DomainEvent,
  type EventBus,
  type EventLog,
  type NewEvent,
} from '@darkbeacon/core';
import { AuditStamper } from '@darkbeacon/audit';
import { json, type Database } from '@darkbeacon/db';

export interface EventTables {
  event_stream: { stream: string; head_seq: number; head_hash: string | null };
  event_log: {
    id: string;
    stream: string;
    seq: number;
    type: string;
    occurred_at: number;
    actor_kind: string;
    actor_id: string;
    data: string;
    v: number;
    audit: string | null;
    revert_of: string | null;
    prev_hash: string | null;
    hash: string | null;
  };
  event_ref: { ref: string; stream: string; seq: number; occurred_at: number };
}

export type EventRow = EventTables['event_log'];

const INSERT_CHUNK = 200;

/**
 * The hash of one stored event, chained to the one before it in the stream. Covers the stored
 * text of every column, so any edit of a row (or a removed row in the middle) breaks the chain.
 */
export function eventHash(row: Omit<EventRow, 'hash'>): string {
  return createHash('sha256')
    .update(
      [
        row.prev_hash ?? '',
        row.id,
        row.stream,
        String(row.seq),
        row.type,
        String(row.occurred_at),
        row.actor_kind,
        row.actor_id,
        row.data,
        String(row.v),
        row.audit ?? '',
        row.revert_of ?? '',
      ].join('\n'),
    )
    .digest('hex');
}

export interface EventLogAudit {
  stamper: AuditStamper;
  scope: AuditScope;
}

/**
 * EventLog over the `event_log` outbox. Seqs come from `event_stream.head_seq`, bumped with
 * an upsert; the row lock serializes writers per stream, so seq order is commit order.
 * Every event is stored with its audit record, its refs and its place in the stream's hash chain.
 */
export class KyselyEventLog implements EventLog {
  private readonly audit: EventLogAudit;

  constructor(
    private readonly database: Database,
    private readonly bus: EventBus,
    audit: Partial<EventLogAudit> = {},
  ) {
    this.audit = { stamper: audit.stamper ?? new AuditStamper(), scope: audit.scope ?? noAuditScope };
  }

  append(events: readonly NewEvent[]): Promise<DomainEvent[]> {
    if (events.length === 0) return Promise.resolve([]);
    return this.database.transaction(async () => {
      const db = this.database.db<EventTables>();
      const stamps = await this.audit.stamper.stamp(events, this.audit.scope.current());
      const counts = new Map<string, number>();
      for (const e of events) counts.set(e.stream, (counts.get(e.stream) ?? 0) + 1);

      const next = new Map<string, { seq: number; hash: string | null }>();
      for (const [stream, count] of counts) {
        const head = await db
          .insertInto('event_stream')
          .values({ stream, head_seq: count, head_hash: null })
          .onConflict((oc) =>
            oc.column('stream').doUpdateSet((eb) => ({ head_seq: eb('event_stream.head_seq', '+', count) })),
          )
          .returning(['head_seq', 'head_hash'])
          .executeTakeFirstOrThrow();
        next.set(stream, { seq: Number(head.head_seq) - count + 1, hash: head.head_hash });
      }

      const stored: DomainEvent[] = [];
      const rows: EventRow[] = [];
      const refs: Array<EventTables['event_ref']> = [];
      events.forEach((e, i) => {
        const position = next.get(e.stream)!;
        const event: DomainEvent = {
          id: e.id,
          seq: position.seq,
          stream: e.stream,
          type: e.type,
          occurredAt: e.occurredAt,
          actor: e.actor,
          data: e.data,
          v: 1,
        };
        const { record, refs: found } = stamps[i]!;
        const unhashed: Omit<EventRow, 'hash'> = {
          ...toRow(event),
          audit: json.encode(record),
          revert_of: record.revertOf,
          prev_hash: position.hash,
        };
        const hash = eventHash(unhashed);
        rows.push({ ...unhashed, hash });
        for (const ref of found)
          refs.push({ ref, stream: event.stream, seq: event.seq, occurred_at: event.occurredAt });
        next.set(e.stream, { seq: position.seq + 1, hash });
        stored.push(event);
      });

      for (let i = 0; i < rows.length; i += INSERT_CHUNK)
        await db
          .insertInto('event_log')
          .values(rows.slice(i, i + INSERT_CHUNK))
          .execute();
      for (let i = 0; i < refs.length; i += INSERT_CHUNK)
        await db
          .insertInto('event_ref')
          .values(refs.slice(i, i + INSERT_CHUNK))
          .execute();
      for (const [stream, { hash }] of next)
        await db.updateTable('event_stream').set({ head_hash: hash }).where('stream', '=', stream).execute();

      this.database.afterCommit(() => this.bus.publish(stored));
      return stored;
    });
  }

  async readSince(stream: string, sinceSeq: number, limit = 1000): Promise<DomainEvent[]> {
    const rows = await this.database
      .db<EventTables>()
      .selectFrom('event_log')
      .select(['id', 'stream', 'seq', 'type', 'occurred_at', 'actor_kind', 'actor_id', 'data', 'v'])
      .where('stream', '=', stream)
      .where('seq', '>', sinceSeq)
      .orderBy('seq')
      .limit(limit)
      .execute();
    return rows.map(fromRow);
  }

  async headSeq(stream: string): Promise<number> {
    const row = await this.database
      .db<EventTables>()
      .selectFrom('event_stream')
      .select('head_seq')
      .where('stream', '=', stream)
      .executeTakeFirst();
    return row?.head_seq ?? 0;
  }

  async oldestSeq(stream: string): Promise<number | null> {
    const row = await this.database
      .db<EventTables>()
      .selectFrom('event_log')
      .select((eb) => eb.fn.min<number>('seq').as('oldest'))
      .where('stream', '=', stream)
      .executeTakeFirst();
    return row?.oldest == null ? null : Number(row.oldest);
  }

  async prune(before: number): Promise<number> {
    return this.database.transaction(async () => {
      const db = this.database.db<EventTables>();
      await db.deleteFrom('event_ref').where('occurred_at', '<', before).execute();
      const result = await db.deleteFrom('event_log').where('occurred_at', '<', before).executeTakeFirst();
      return Number(result.numDeletedRows);
    });
  }
}

function toRow(e: DomainEvent): Omit<EventRow, 'audit' | 'revert_of' | 'prev_hash' | 'hash'> {
  return {
    id: e.id,
    stream: e.stream,
    seq: e.seq,
    type: e.type,
    occurred_at: e.occurredAt,
    actor_kind: e.actor.kind,
    actor_id: e.actor.id,
    data: json.encode(e.data),
    v: e.v,
  };
}

export function fromRow(
  row: Pick<EventRow, 'id' | 'stream' | 'seq' | 'type' | 'occurred_at' | 'actor_kind' | 'actor_id' | 'data'>,
): DomainEvent {
  return {
    id: row.id,
    seq: Number(row.seq),
    stream: row.stream,
    type: row.type,
    occurredAt: Number(row.occurred_at),
    actor: { kind: row.actor_kind as ActorKind, id: row.actor_id },
    data: json.decode(row.data),
    v: 1,
  };
}
