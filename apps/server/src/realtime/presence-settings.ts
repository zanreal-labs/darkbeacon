import { Body, Controller, Get, Inject, Injectable, Put } from '@nestjs/common';
import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import { bool, Database } from '@darkbeacon/db';
import {
  nestPath,
  routes,
  UpdatePresenceSettingsRequest,
  type PresenceSettingsDto,
} from '@darkbeacon/shared';
import { CurrentActor } from '../platform/actor.js';
import { ZodPipe } from '../platform/http.js';
import { CLOCK } from '../platform/tokens.js';
import { DEFAULT_PRESENCE_SETTINGS } from './presence.js';
import { RealtimeHub } from './realtime.hub.js';

interface PresenceTables {
  presence_setting: { account_id: string; share_cursor: number; show_others: number; updated_at: number };
}

/** Per-account presence choices (share my cursor, show others). Presence itself is never stored. */
@Injectable()
export class PresenceSettingsStore {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(accountId: string): Promise<PresenceSettingsDto> {
    const row = await this.database
      .db<PresenceTables>()
      .selectFrom('presence_setting')
      .selectAll()
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row
      ? { shareCursor: bool.decode(row.share_cursor), showOthers: bool.decode(row.show_others) }
      : DEFAULT_PRESENCE_SETTINGS;
  }

  async update(accountId: string, patch: UpdatePresenceSettingsRequest): Promise<PresenceSettingsDto> {
    return this.database.transaction(async () => {
      const next = { ...(await this.get(accountId)), ...definedOnly(patch) };
      const values = {
        share_cursor: bool.encode(next.shareCursor),
        show_others: bool.encode(next.showOthers),
        updated_at: this.clock.now(),
      };
      await this.database
        .db<PresenceTables>()
        .insertInto('presence_setting')
        .values({ account_id: accountId, ...values })
        .onConflict((oc) => oc.column('account_id').doUpdateSet(values))
        .execute();
      return next;
    });
  }
}

function definedOnly(patch: UpdatePresenceSettingsRequest): Partial<PresenceSettingsDto> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
}

const r = routes.presence;

@Controller()
export class PresenceSettingsController {
  constructor(
    @Inject(PresenceSettingsStore) private readonly store: PresenceSettingsStore,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get(nestPath(r.settings.path))
  get(@CurrentActor() actor: Actor | null): Promise<PresenceSettingsDto> {
    return this.store.get(requireAccount(actor).id);
  }

  @Put(nestPath(r.updateSettings.path))
  async update(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(UpdatePresenceSettingsRequest)) body: UpdatePresenceSettingsRequest,
  ): Promise<PresenceSettingsDto> {
    const account = requireAccount(actor);
    const settings = await this.store.update(account.id, body);
    // Open tabs follow at once: others stop (or start) seeing the cursor.
    this.hub.presenceSettingsChanged(account.id, settings);
    return settings;
  }
}
