import { json, type Database } from '@darkbeacon/db';
import type { JumpShare, JumpShareStore } from '@darkbeacon/jumps';
import type { JumpFuelHub, JumpPlanInput, JumpShareFreight } from '@darkbeacon/shared';

export interface JumpShareTables {
  jump_shares: {
    token: string;
    request: string;
    fuel_hub: string;
    /** `{ route, freight }` (see `JumpShare`); null for links shared before they were kept. */
    options: string | null;
    created_by: string;
    created_at: number;
  };
}

export class KyselyJumpShareStore implements JumpShareStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<JumpShareTables>();
  }

  async save(share: JumpShare): Promise<void> {
    await this.db
      .insertInto('jump_shares')
      .values({
        token: share.token,
        request: json.encode(share.request),
        fuel_hub: share.fuelHub,
        options: json.encode({ route: share.route, freight: share.freight }),
        created_by: share.createdBy,
        created_at: share.createdAt,
      })
      .execute();
  }

  async find(token: string): Promise<JumpShare | null> {
    const row = await this.db
      .selectFrom('jump_shares')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row) return null;
    const options = row.options
      ? json.decode<{ route: string | null; freight: JumpShareFreight | null }>(row.options)
      : null;
    return {
      token: row.token,
      request: json.decode<JumpPlanInput>(row.request)!,
      fuelHub: row.fuel_hub as JumpFuelHub,
      route: options?.route ?? null,
      freight: options?.freight ?? null,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
    };
  }
}
