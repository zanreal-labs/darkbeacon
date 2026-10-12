import type { Database } from '@darkbeacon/db';
import type { GaugeSources } from '@darkbeacon/observability';

/** The tables counted, read-only (their modules own them). */
interface CountedTables {
  character_presence: { online: number };
  maps: { id: string };
}

/**
 * Gauge values from the database (counts only), the event-log consumers and the realtime hub.
 * Read only when metrics are collected.
 */
export class KyselyGaugeSources implements GaugeSources {
  constructor(
    private readonly database: Database,
    private readonly consumers: { lag(): Promise<Array<{ consumer: string; behind: number }>> },
    private readonly realtime: { readonly connectionCount: number },
  ) {}

  private get db() {
    return this.database.db<CountedTables>();
  }

  async onlineCharacters(): Promise<number> {
    const row = await this.db
      .selectFrom('character_presence')
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .where('online', '=', 1)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async maps(): Promise<number> {
    const row = await this.db
      .selectFrom('maps')
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  consumerLag(): Promise<Array<{ consumer: string; behind: number }>> {
    return this.consumers.lag();
  }

  realtimeConnections(): number {
    return this.realtime.connectionCount;
  }
}
