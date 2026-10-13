import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Clock, EventLog } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { AccountService, CharacterService } from '@darkbeacon/identity';
import {
  SupportClientService,
  SupportHub,
  SupportInbox,
  type FeedbackSink,
  type SupportDesk,
} from '@darkbeacon/support';
import type { FetchLike } from '../../adapters/identity/oauth-http.js';
import { SecretBox } from '../../adapters/identity/secret-box.js';
import { AppSupportAccounts } from '../../adapters/support/app-support-accounts.js';
import {
  KyselyClientHandles,
  KyselySupportHandles,
  KyselySupportIdentities,
  KyselyTicketNotes,
} from '../../adapters/support/kysely-support-stores.js';
import { LocalSupportDesk } from '../../adapters/support/local-support-desk.js';
import { PostHogSupportDesk } from '../../adapters/support/posthog-support-desk.js';
import { PostHogSurveys } from '../../adapters/support/posthog-surveys.js';
import { bucketLimiter, nodeSupportCrypto } from '../../adapters/support/support-runtime.js';
import type { AppConfig } from '../../config/config.js';
import { RateLimiter } from '../../platform/rate-limiter.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, HTTP_FETCH } from '../../platform/tokens.js';
import { APP_VERSION } from '../../platform/version.js';
import {
  SupportAdminController,
  SupportClientController,
  SupportHubController,
} from './support.controller.js';
import { supportSettings, type SupportSettings } from './support.settings.js';
import { SUPPORT_HUB, SUPPORT_INBOX, SUPPORT_SETTINGS } from './support.tokens.js';

/** The name pilots see on answers from the hub's own inbox. */
const SUPPORT_AUTHOR = 'Darkbeacon support';

type Settings = SupportSettings & { publicUrl: string };

@Injectable()
class SupportStartup implements OnApplicationBootstrap {
  constructor(@Inject(SUPPORT_SETTINGS) private readonly settings: Settings) {}

  onApplicationBootstrap(): void {
    const logger = new Logger('Support');
    for (const problem of this.settings.problems) logger.warn(problem);
    if (this.settings.hub) logger.log(`support hub is on (${this.settings.hub.backend} desk)`);
  }
}

/**
 * Support tickets and feedback (docs/support.md). On every instance: the help menu's target and
 * each account's unread handle. On a hub (SUPPORT_HUB=on): tickets of its accounts' EVE characters
 * (pilots sign in as to any instance) through PostHog Support or its own tables, feedback, unread
 * handles and, with its own tables, an inbox for its admins. Self-contained like telemetry: its
 * own environment, tables and routes; it reads accounts and characters from identity.
 */
@Module({
  controllers: [SupportClientController, SupportHubController, SupportAdminController],
  providers: [
    SupportStartup,
    {
      provide: SUPPORT_SETTINGS,
      useFactory: (config: AppConfig): Settings => ({
        ...supportSettings(process.env, config),
        publicUrl: config.publicUrl,
      }),
      inject: [APP_CONFIG],
    },
    {
      provide: LocalSupportDesk,
      useFactory: (database: Database, clock: Clock) => new LocalSupportDesk(database, clock),
      inject: [Database, CLOCK],
    },
    {
      provide: SUPPORT_HUB,
      useFactory: (
        settings: Settings,
        database: Database,
        local: LocalSupportDesk,
        events: EventLog,
        clock: Clock,
        fetch: FetchLike,
        limiter: RateLimiter,
        accounts: AccountService,
        characters: CharacterService,
      ): SupportHub | null => {
        const hub = settings.hub;
        if (!hub) return null;
        const origin = new URL(settings.publicUrl).origin;
        const userAgent = `darkbeacon-hub/${APP_VERSION}`;
        let desk: SupportDesk = local;
        let feedback: FeedbackSink | null = local;
        if (hub.backend === 'posthog' && hub.posthog) {
          desk = new PostHogSupportDesk({ ...hub.posthog, origin, fetch, userAgent });
          feedback = hub.surveys ? new PostHogSurveys({ ...hub.surveys, fetch, userAgent }) : null;
        }
        return new SupportHub({
          desk,
          feedback,
          accounts: new AppSupportAccounts(accounts, characters),
          identities: new KyselySupportIdentities(database),
          handles: new KyselySupportHandles(database),
          notes: new KyselyTicketNotes(database),
          crypto: nodeSupportCrypto,
          limiter: bucketLimiter(limiter),
          events,
          clock,
        });
      },
      inject: [
        SUPPORT_SETTINGS,
        Database,
        LocalSupportDesk,
        EVENT_LOG,
        CLOCK,
        HTTP_FETCH,
        RateLimiter,
        AccountService,
        CharacterService,
      ],
    },
    {
      provide: SUPPORT_INBOX,
      useFactory: (
        settings: Settings,
        hub: SupportHub | null,
        local: LocalSupportDesk,
        events: EventLog,
        clock: Clock,
      ): SupportInbox | null =>
        hub && settings.hub?.backend === 'local'
          ? new SupportInbox({
              desk: local,
              hub,
              events,
              clock,
              authorName: () => Promise.resolve(SUPPORT_AUTHOR),
            })
          : null,
      inject: [SUPPORT_SETTINGS, SUPPORT_HUB, LocalSupportDesk, EVENT_LOG, CLOCK],
    },
    {
      provide: SupportClientService,
      useFactory: (
        settings: Settings,
        config: AppConfig,
        database: Database,
        instance: InstanceSettingsService,
        clock: Clock,
      ) =>
        new SupportClientService({
          config: {
            hubUrl: settings.hubUrl,
            inApp: settings.hub !== null && settings.hubUrl === new URL(config.publicUrl).origin,
            localInbox: settings.hub?.backend === 'local',
            instance: {
              appVersion: APP_VERSION,
              commit: commitOf(process.env.DBK_COMMIT),
              db: database.dialect,
              demo: config.demoMode,
            },
          },
          handles: new KyselyClientHandles(database, new SecretBox(config.secretKey, 'support-handle')),
          loginMethod: () => instance.loginMethod(),
          clock,
        }),
      inject: [SUPPORT_SETTINGS, APP_CONFIG, Database, InstanceSettingsService, CLOCK],
    },
  ],
})
export class SupportModule {}

function commitOf(value: string | undefined): string | null {
  const commit = value?.trim().toLowerCase();
  return commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 12) : null;
}
