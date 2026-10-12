import type { ActorKind, DomainEvent, EventBus, EventLog, NewEvent } from '@darkbeacon/core';
import { json, type Database } from '@darkbeacon/db';

export interface EventTables {
  event_stream: { stream: string; head_seq: number };
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
  };
}

type EventRow = EventTables['event_log'];

const INSERT_CHUNK = 200;

/**
 * EventLog over the `event_log` outbox. Seqs come from `event_stream.head_seq`, bumped with
 * an upsert; the row lock serializes writers per stream, so seq order is commit order.
 */
export class KyselyEventLog implements EventLog {
  constructor(
    private readonly database: Database,
    private readonly bus: EventBus,
  ) {}

  append(events: readonly NewEvent[]): Promise<DomainEvent[]> {
    if (events.length === 0) return Promise.resolve([]);
    return this.database.transaction(async () => {
      const db = this.database.db<EventTables>();
      const counts = new Map<string, number>();
      for (const e of events) counts.set(e.stream, (counts.get(e.stream) ?? 0) + 1);

      const nextSeq = new Map<string, number>();
      for (const [stream, count] of counts) {
        const { head_seq } = await db
          .insertInto('event_stream')
          .values({ stream, head_seq: count })
          .onConflict((oc) =>
            oc.column('stream').doUpdateSet((eb) => ({ head_seq: eb('event_stream.head_seq', '+', count) })),
          )
          .returning('head_seq')
          .executeTakeFirstOrThrow();
        nextSeq.set(stream, head_seq - count + 1);
      }

      const stored = events.map((e): DomainEvent => {
        const seq = nextSeq.get(e.stream)!;
        nextSeq.set(e.stream, seq + 1);
        return { ...e, seq, v: 1 };
      });
      for (let i = 0; i < stored.length; i += INSERT_CHUNK) {
        await db
          .insertInto('event_log')
          .values(stored.slice(i, i + INSERT_CHUNK).map(toRow))
          .execute();
      }
      this.database.afterCommit(() => this.bus.publish(stored));
      return stored;
    });
  }

  async readSince(stream: string, sinceSeq: number, limit = 1000): Promise<DomainEvent[]> {
    const rows = await this.database
      .db<EventTables>()
      .selectFrom('event_log')
      .selectAll()
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
    const result = await this.database
      .db<EventTables>()
      .deleteFrom('event_log')
      .where('occurred_at', '<', before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

function toRow(e: DomainEvent): EventRow {
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

function fromRow(row: EventRow): DomainEvent {
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
