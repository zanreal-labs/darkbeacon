import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Clock, EventLog, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  AccountService,
  AffiliationRefresh,
  CharacterService,
  CharacterWallets,
  UserPreferences,
  DemoLogin,
  DiscordBotService,
  DiscordLogin,
  EveDirectoryService,
  EveLogin,
  GuildRoleSync,
  SessionService,
  SignUpGate,
  type CharacterRepository,
  type DiscordLinkRepository,
  type IdentityProvider,
} from '@darkbeacon/identity';
import { DiscordBotHttp } from '../../adapters/identity/discord-bot-http.js';
import { DiscordHttpProvider } from '../../adapters/identity/discord-http.js';
import { EsiDirectoryHttp } from '../../adapters/identity/esi-directory-http.js';
import { EsiPublicHttp } from '../../adapters/identity/esi-public-http.js';
import { EveSsoHttp } from '../../adapters/identity/eve-sso-http.js';
import { KyselyUserPreferences } from '../../adapters/identity/kysely-user-preferences.js';
import {
  KyselyAccountRepository,
  KyselyCharacterRepository,
  KyselyDiscordBotStore,
  KyselyDiscordLinkRepository,
  KyselyInviteRepository,
  KyselySessionRepository,
} from '../../adapters/identity/kysely-identity.js';
import { DiscordDirectoryController, EveDirectoryController } from './directory.controller.js';
import { PickerAccess } from './picker-access.js';
import type { FetchLike } from '../../adapters/identity/oauth-http.js';
import { SecretBox } from '../../adapters/identity/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';
import { AuditDirectoryRegistry } from '../../platform/audit.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, HTTP_FETCH, UNIT_OF_WORK } from '../../platform/tokens.js';
import { AccountsController, AdminAccountsController } from './accounts.controller.js';
import { AdminIdentityController } from './admin-identity.controller.js';
import { AuthController, oauthCallbackUrl } from './auth.controller.js';
import { readSessionCookie } from './cookies.js';
import { PENDING_BOX } from './identity.tokens.js';
import { PreferencesController } from './preferences.controller.js';
import { SignInAudit } from './sign-in-audit.js';

const DISCORD = 'identity.Discord';
const ACCOUNTS = 'identity.AccountRepository';
const SESSIONS = 'identity.SessionRepository';
const CHARACTERS = 'identity.CharacterRepository';
const DISCORD_LINKS = 'identity.DiscordLinkRepository';
const ESI_PUBLIC = 'identity.EsiPublic';
/** How often every linked character's corporation and alliance is read again (ESI caches it an hour). */
const AFFILIATION_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Accounts, sessions, Discord login and EVE character linking. Installs the actor resolver:
 * the session cookie becomes an account actor on every HTTP request and WebSocket.
 * Exports `AccountService` and `CharacterService` (also tracking's CharacterTokenSource).
 */
@Global()
@Module({
  controllers: [
    AuthController,
    AccountsController,
    AdminAccountsController,
    AdminIdentityController,
    EveDirectoryController,
    DiscordDirectoryController,
    PreferencesController,
  ],
  providers: [
    SignInAudit,
    {
      provide: PENDING_BOX,
      useFactory: (config: AppConfig) => new SecretBox(config.secretKey, 'oauth-state'),
      inject: [APP_CONFIG],
    },
    {
      provide: DISCORD,
      useFactory: (config: AppConfig, clock: Clock, fetchFn: FetchLike) =>
        config.discord ? new DiscordHttpProvider(config.discord, clock, fetchFn) : null,
      inject: [APP_CONFIG, CLOCK, HTTP_FETCH],
    },
    { provide: ACCOUNTS, useFactory: (db: Database) => new KyselyAccountRepository(db), inject: [Database] },
    { provide: SESSIONS, useFactory: (db: Database) => new KyselySessionRepository(db), inject: [Database] },
    {
      provide: CHARACTERS,
      useFactory: (db: Database, config: AppConfig) =>
        new KyselyCharacterRepository(db, new SecretBox(config.secretKey, 'eve-tokens')),
      inject: [Database, APP_CONFIG],
    },
    {
      provide: DISCORD_LINKS,
      useFactory: (db: Database, config: AppConfig) =>
        new KyselyDiscordLinkRepository(db, new SecretBox(config.secretKey, 'discord-tokens')),
      inject: [Database, APP_CONFIG],
    },
    {
      provide: AccountService,
      useFactory: (
        accounts: KyselyAccountRepository,
        characters: CharacterRepository,
        discordLinks: DiscordLinkRepository,
        settings: InstanceSettingsService,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
      ) =>
        new AccountService({
          accounts,
          characters,
          discordLinks,
          guildPolicy: settings,
          loginPolicy: settings,
          uow,
          events,
          clock,
        }),
      inject: [ACCOUNTS, CHARACTERS, DISCORD_LINKS, InstanceSettingsService, UNIT_OF_WORK, EVENT_LOG, CLOCK],
    },
    {
      provide: EveDirectoryService,
      useFactory: (
        characters: CharacterService,
        accounts: KyselyAccountRepository,
        clock: Clock,
        fetchFn: FetchLike,
        config: AppConfig,
      ) =>
        new EveDirectoryService({
          directory: new EsiDirectoryHttp(clock, fetchFn, `Darkbeacon (${config.publicUrl})`),
          characters,
          accounts,
          clock,
        }),
      inject: [CharacterService, ACCOUNTS, CLOCK, HTTP_FETCH, APP_CONFIG],
    },
    {
      provide: DiscordBotService,
      useFactory: (db: Database, config: AppConfig, clock: Clock, fetchFn: FetchLike) =>
        new DiscordBotService({
          api: new DiscordBotHttp(fetchFn),
          store: new KyselyDiscordBotStore(db, new SecretBox(config.secretKey, 'discord-bot')),
          clock,
        }),
      inject: [Database, APP_CONFIG, CLOCK, HTTP_FETCH],
    },
    {
      provide: EveLogin,
      useFactory: (
        characters: CharacterService,
        accounts: AccountService,
        sessions: SessionService,
        settings: InstanceSettingsService,
        signUp: SignUpGate,
      ) => new EveLogin({ characters, accounts, sessions, loginPolicy: settings, signUp }),
      inject: [CharacterService, AccountService, SessionService, InstanceSettingsService, SignUpGate],
    },
    {
      provide: SignUpGate,
      useFactory: (
        db: Database,
        settings: InstanceSettingsService,
        accounts: KyselyAccountRepository,
        discord: IdentityProvider | null,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
      ) =>
        new SignUpGate({
          invites: new KyselyInviteRepository(db),
          rules: settings,
          accounts,
          discord,
          uow,
          events,
          clock,
        }),
      inject: [Database, InstanceSettingsService, ACCOUNTS, DISCORD, UNIT_OF_WORK, EVENT_LOG, CLOCK],
    },
    PickerAccess,
    {
      provide: SessionService,
      useFactory: (
        sessions: KyselySessionRepository,
        accounts: KyselyAccountRepository,
        events: EventLog,
        clock: Clock,
      ) => new SessionService({ sessions, accounts, events, clock }),
      inject: [SESSIONS, ACCOUNTS, EVENT_LOG, CLOCK],
    },
    {
      provide: GuildRoleSync,
      useFactory: (
        discord: IdentityProvider | null,
        discordLinks: DiscordLinkRepository,
        guildPolicy: InstanceSettingsService,
        events: EventLog,
        clock: Clock,
      ) => new GuildRoleSync({ discord, discordLinks, guildPolicy, events, clock }),
      inject: [DISCORD, DISCORD_LINKS, InstanceSettingsService, EVENT_LOG, CLOCK],
    },
    {
      provide: DiscordLogin,
      useFactory: (
        discord: IdentityProvider | null,
        accounts: AccountService,
        guildRoles: GuildRoleSync,
        sessions: SessionService,
        clock: Clock,
        config: AppConfig,
        settings: InstanceSettingsService,
        accountRepository: KyselyAccountRepository,
        signUp: SignUpGate,
      ) =>
        new DiscordLogin({
          discord,
          accounts,
          guildRoles,
          sessions,
          loginPolicy: settings,
          accountRepository,
          signUp,
          clock,
          redirectUri: oauthCallbackUrl(config, 'discord'),
        }),
      inject: [
        DISCORD,
        AccountService,
        GuildRoleSync,
        SessionService,
        CLOCK,
        APP_CONFIG,
        InstanceSettingsService,
        ACCOUNTS,
        SignUpGate,
      ],
    },
    {
      provide: DemoLogin,
      useFactory: (
        config: AppConfig,
        accounts: AccountService,
        characters: CharacterRepository,
        sessions: SessionService,
        uow: UnitOfWork,
        clock: Clock,
      ) => new DemoLogin({ enabled: config.demoMode, accounts, characters, sessions, uow, clock }),
      inject: [APP_CONFIG, AccountService, CHARACTERS, SessionService, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: CharacterService,
      useFactory: (
        config: AppConfig,
        characters: CharacterRepository,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
        fetchFn: FetchLike,
      ) =>
        new CharacterService({
          eve: config.eve ? new EveSsoHttp(config.eve, clock, fetchFn) : null,
          characters,
          uow,
          events,
          clock,
          redirectUri: oauthCallbackUrl(config, 'eve'),
        }),
      inject: [APP_CONFIG, CHARACTERS, UNIT_OF_WORK, EVENT_LOG, CLOCK, HTTP_FETCH],
    },
    {
      provide: ESI_PUBLIC,
      useFactory: (fetchFn: FetchLike, config: AppConfig) =>
        new EsiPublicHttp(fetchFn, `Darkbeacon (+${config.publicUrl})`),
      inject: [HTTP_FETCH, APP_CONFIG],
    },
    {
      provide: UserPreferences,
      useFactory: (db: Database, clock: Clock) =>
        new UserPreferences({ preferences: new KyselyUserPreferences(db), clock }),
      inject: [Database, CLOCK],
    },
    {
      provide: CharacterWallets,
      useFactory: (characters: CharacterService, esi: EsiPublicHttp, clock: Clock) =>
        new CharacterWallets({ characters, wallet: esi, clock }),
      inject: [CharacterService, ESI_PUBLIC, CLOCK],
    },
    {
      provide: AffiliationRefresh,
      useFactory: (
        characters: CharacterRepository,
        esi: EsiPublicHttp,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new AffiliationRefresh({ characters, esi, events, uow, clock }),
      inject: [CHARACTERS, ESI_PUBLIC, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
  ],
  exports: [
    AccountService,
    UserPreferences,
    CharacterService,
    SignUpGate,
    SessionService,
    DemoLogin,
    SignInAudit,
    EveDirectoryService,
    DiscordBotService,
    PickerAccess,
  ],
})
export class IdentityModule implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Identity');
  private timer: NodeJS.Timeout | undefined;
  private affiliationTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(GuildRoleSync) private readonly guildRoles: GuildRoleSync,
    @Inject(DiscordLogin) private readonly discordLogin: DiscordLogin,
    @Inject(AuditDirectoryRegistry) private readonly directory: AuditDirectoryRegistry,
    @Inject(ACCOUNTS) private readonly accountRepository: KyselyAccountRepository,
    @Inject(CHARACTERS) private readonly characterRepository: CharacterRepository,
    @Inject(DiscordBotService) private readonly bot: DiscordBotService,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(AffiliationRefresh) private readonly affiliations: AffiliationRefresh,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.maintenance.register({
      name: 'identity',
      resume: (restored) => {
        if (restored) this.bot.forgetCachedLists();
      },
    });
    // Names and main characters for the audit trail, read when an event is written.
    this.directory.use({
      account: async (accountId) => {
        const account = await this.accountRepository.findById(accountId);
        if (!account) return null;
        const main = account.mainCharacterId
          ? await this.characterRepository.findById(account.mainCharacterId)
          : null;
        const ownMain = main?.accountId === account.id ? main : null;
        return {
          name: account.name,
          mainCharacterId: ownMain?.id ?? null,
          mainCharacterName: ownMain?.name ?? null,
        };
      },
      character: async (characterId) => {
        const character = await this.characterRepository.findById(characterId);
        if (!character) return null;
        const account = await this.accountRepository.findById(character.accountId);
        return { name: character.name, accountId: character.accountId, accountName: account?.name ?? null };
      },
    });
    this.actors.use(async (request) => {
      const resolved = await this.sessions.resolve(readSessionCookie(request));
      if (!resolved) return null;
      if (this.discordLogin.enabled) {
        // Keeps Discord roles fresh without delaying the request.
        this.guildRoles
          .refreshIfStale(resolved.account.id)
          .catch((error: unknown) => this.logger.warn(`guild role refresh failed: ${String(error)}`));
      }
      return this.accounts.actorFor(resolved.account);
    });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => {
        this.sessions
          .pruneExpired()
          .catch((error: unknown) => this.logger.error(`session cleanup failed: ${String(error)}`));
      },
      60 * 60 * 1000,
    ).unref();
    // Tests run the refresh themselves.
    if (this.config.env !== 'test') {
      this.affiliationTimer = setInterval(() => {
        if (this.maintenance.active) return;
        this.affiliations
          .run()
          .catch((error: unknown) => this.logger.warn(`affiliation refresh failed: ${String(error)}`));
      }, AFFILIATION_INTERVAL_MS).unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.affiliationTimer);
  }
}
