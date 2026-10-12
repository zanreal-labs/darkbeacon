import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@darkbeacon/db';
import type { TelemetryStateStore } from '@darkbeacon/telemetry';

interface TelemetryTables {
  telemetry_state: { key: string; value: string };
  telemetry_notice: { account_id: string; dismissed_at: number };
}

const INSTANCE_ID = 'instance_id';
const SECRET = 'pseudonym_secret';
const ENABLED = 'enabled';
const LAST_HEARTBEAT = 'last_heartbeat_at';

/** Telemetry's own key -> value table and the notice dismissals. */
export class KyselyTelemetryState implements TelemetryStateStore {
  private cached: { instanceId: string; secret: string } | null = null;

  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<TelemetryTables>();
  }

  private async get(key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('telemetry_state')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return row?.value ?? null;
  }

  private async set(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('telemetry_state')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute();
  }

  async identity(): Promise<{ instanceId: string; secret: string }> {
    if (this.cached) return this.cached;
    // Created once; a concurrent first start keeps whichever row won.
    for (const [key, make] of [
      [INSTANCE_ID, () => randomUUID()],
      [SECRET, () => randomBytes(32).toString('base64url')],
    ] as const) {
      await this.db
        .insertInto('telemetry_state')
        .values({ key, value: make() })
        .onConflict((oc) => oc.column('key').doNothing())
        .execute();
    }
    this.cached = { instanceId: (await this.get(INSTANCE_ID))!, secret: (await this.get(SECRET))! };
    return this.cached;
  }

  async adminEnabled(): Promise<boolean | null> {
    const value = await this.get(ENABLED);
    return value === null ? null : value === 'true';
  }

  setAdminEnabled(enabled: boolean): Promise<void> {
    return this.set(ENABLED, String(enabled));
  }

  async lastHeartbeatAt(): Promise<number | null> {
    const value = await this.get(LAST_HEARTBEAT);
    return value === null ? null : Number(value);
  }

  setLastHeartbeatAt(at: number): Promise<void> {
    return this.set(LAST_HEARTBEAT, String(at));
  }

  async noticeDismissed(accountId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('telemetry_notice')
      .select('account_id')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async dismissNotice(accountId: string, at: number): Promise<void> {
    await this.db
      .insertInto('telemetry_notice')
      .values({ account_id: accountId, dismissed_at: at })
      .onConflict((oc) => oc.column('account_id').doNothing())
      .execute();
  }
}
