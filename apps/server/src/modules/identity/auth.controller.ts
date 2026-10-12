import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import { isDomainError, requireAccount, type Actor } from '@darkbeacon/core';
import {
  AccountService,
  CharacterService,
  DemoLogin,
  DiscordLogin,
  EveLogin,
  safeReturnTo,
  SESSION_TTL_MS,
  SessionService,
  type PendingAuth,
} from '@darkbeacon/identity';
import { DevLoginRequest, nestPath, routes, type AuthProvidersDto, type MeDto } from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SecretBox } from '../../adapters/identity/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { SignInCookies } from '../../platform/sign-in-cookies.js';
import { APP_CONFIG } from '../../platform/tokens.js';
import {
  clearCookie,
  DEMO_OPT_OUT_COOKIE,
  LEGACY_SESSION_COOKIE,
  openPending,
  PENDING_COOKIE,
  readCookie,
  readSessionCookie,
  sealPending,
  serializeCookie,
  SESSION_COOKIE,
} from './cookies.js';
import { PENDING_BOX } from './identity.tokens.js';
import { SignInAudit } from './sign-in-audit.js';

type CallbackQuery = { code?: string; state?: string; error?: string };

const PENDING_PATH = '/api/auth';

/** Where Discord and EVE SSO send people back to; registered with each provider. */
export const oauthCallbackUrl = (config: AppConfig, provider: 'discord' | 'eve') =>
  `${config.publicUrl}/api/auth/${provider}/callback`;

@Controller()
export class AuthController {
  private readonly logger = new Logger('Auth');
  private readonly secure: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PENDING_BOX) private readonly box: SecretBox,
    @Inject(DiscordLogin) private readonly discord: DiscordLogin,
    @Inject(DemoLogin) private readonly demo: DemoLogin,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(SignInCookies) private readonly signInCookies: SignInCookies,
    @Inject(SignInAudit) private readonly audit: SignInAudit,
    @Inject(EveLogin) private readonly eveSignin: EveLogin,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
  ) {
    this.secure = config.publicUrl.startsWith('https://');
  }

  @Get(nestPath(routes.auth.providers.path))
  async providers(): Promise<AuthProvidersDto> {
    return {
      discord: this.discord.enabled,
      eve: this.characters.enabled,
      loginMethod: await this.settings.loginMethod(),
      demo: this.demo.enabled,
      discordRedirectUrl: oauthCallbackUrl(this.config, 'discord'),
    };
  }

  @Get(nestPath(routes.auth.discordLogin.path))
  async discordLogin(
    @Query('returnTo') returnTo: unknown,
    @Query('invite') invite: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.redirect(reply, '/', async () =>
      this.begin(reply, await this.discord.start(returnTo, invite)),
    );
  }

  @Get(nestPath(routes.auth.discordConnect.path))
  async discordConnect(
    @CurrentActor() actor: Actor | null,
    @Query('returnTo') returnTo: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.redirect(reply, '/account', async () =>
      this.begin(reply, await this.discord.startConnect(actor, returnTo ?? '/account')),
    );
  }

  /** One redirect URI for both Discord round trips: signing in and connecting to an account. */
  @Get(nestPath(routes.auth.discordCallback.path))
  async discordCallback(
    @CurrentActor() actor: Actor | null,
    @Query() query: CallbackQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pending = this.takePending(request, reply);
    await this.redirect(
      reply,
      pending?.returnTo ?? '/',
      async () => {
        const connecting = pending?.kind === 'discord-connect';
        if (query.error) {
          const reason = connecting ? 'Connecting Discord was cancelled' : 'Discord sign-in was cancelled';
          if (!connecting) await this.audit.failed('discord', reason);
          return withError(pending?.returnTo ?? '/', reason);
        }
        const input = { code: query.code, state: query.state, pending };
        if (connecting) {
          const connected = await this.discord.completeConnect(actor, input);
          await this.audit.discordChanged(connected.account.id, true);
          return connected.returnTo;
        }
        const signedIn = await this.discord.complete({ ...input, userAgent: userAgent(request) });
        await this.startSession(request, reply, signedIn.token, signedIn.account.id);
        await this.audit.signedIn(signedIn.account.id, 'discord');
        return signedIn.returnTo;
      },
      async (reason) => {
        if (pending?.kind !== 'discord-connect') await this.audit.failed('discord', reason);
      },
    );
  }

  @Get(nestPath(routes.auth.eveSignIn.path))
  async eveSignIn(
    @Query('returnTo') returnTo: unknown,
    @Query('invite') invite: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.redirect(reply, '/login', async () =>
      this.begin(reply, await this.eveSignin.start(returnTo, invite)),
    );
  }

  @Get(nestPath(routes.auth.eveLogin.path))
  async eveLogin(
    @CurrentActor() actor: Actor | null,
    @Query('returnTo') returnTo: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.redirect(reply, '/', async () =>
      this.begin(reply, await this.characters.startLink(actor, returnTo)),
    );
  }

  @Get(nestPath(routes.auth.eveCallback.path))
  async eveCallback(
    @CurrentActor() actor: Actor | null,
    @Query() query: CallbackQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pending = this.takePending(request, reply);
    // A failed sign-in goes back to the sign-in page, a failed link to where it started.
    const fallback = pending?.kind === 'eve-signin' ? '/login' : (pending?.returnTo ?? '/');
    const signingIn = pending?.kind === 'eve-signin';
    await this.redirect(
      reply,
      fallback,
      async () => {
        if (query.error) {
          if (signingIn) await this.audit.failed('eve', 'EVE sign-in was cancelled');
          return withError(fallback, 'EVE sign-in was cancelled');
        }
        const input = { code: query.code, state: query.state, pending };
        if (signingIn) {
          const signedIn = await this.eveSignin.complete(actor, { ...input, userAgent: userAgent(request) });
          await this.startSession(request, reply, signedIn.token, signedIn.account.id);
          await this.audit.signedIn(signedIn.account.id, 'eve');
          return signedIn.returnTo;
        }
        return (await this.characters.completeLink(actor, input)).returnTo;
      },
      async (reason) => {
        if (signingIn) await this.audit.failed('eve', reason);
      },
    );
  }

  /** Demo mode: a named local account, for scripts and tests (the web app uses /api/auth/demo). */
  @Post(nestPath(routes.auth.dev.path))
  @HttpCode(200)
  async namedLogin(
    @Body(new ZodPipe(DevLoginRequest)) body: DevLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeDto> {
    const signedIn = await this.demo.signIn(body, userAgent(request));
    await this.startSession(request, reply, signedIn.token, signedIn.account.id);
    await this.audit.signedIn(signedIn.account.id, 'dev');
    return this.accounts.me(await this.accounts.actorFor(signedIn.account));
  }

  @Post(nestPath(routes.auth.logout.path))
  @HttpCode(204)
  async logout(
    @CurrentActor() actor: Actor | null,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.logout(readSessionCookie(request));
    if (actor?.kind === 'account') await this.audit.signedOut(actor.id, false);
    this.clearSession(reply);
  }

  @Post(nestPath(routes.auth.logoutEverywhere.path))
  @HttpCode(204)
  async logoutEverywhere(
    @CurrentActor() actor: Actor | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const account = requireAccount(actor);
    await this.sessions.logoutEverywhere(account.id);
    await this.audit.signedOut(account.id, true);
    this.clearSession(reply);
  }

  /** Remembers the round trip in a sealed cookie and returns the provider URL. */
  private begin(reply: FastifyReply, started: { url: string; pending: PendingAuth }): string {
    const maxAgeSeconds = Math.ceil((started.pending.expiresAt - Date.now()) / 1000);
    this.addCookie(
      reply,
      serializeCookie(PENDING_COOKIE, sealPending(this.box, started.pending), {
        maxAgeSeconds: Math.max(maxAgeSeconds, 1),
        path: PENDING_PATH,
        secure: this.secure,
      }),
    );
    return started.url;
  }

  /** Reads the round trip and clears its cookie: a state is usable once. */
  private takePending(request: FastifyRequest, reply: FastifyReply): PendingAuth | null {
    this.addCookie(reply, clearCookie(PENDING_COOKIE, { path: PENDING_PATH, secure: this.secure }));
    return openPending(this.box, readCookie(request, PENDING_COOKIE));
  }

  /** The session cookie, plus what other modules add to a new session (the account's theme). */
  private async startSession(
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
    accountId: string,
  ): Promise<void> {
    this.addCookie(
      reply,
      serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000, secure: this.secure }),
    );
    for (const cookie of await this.signInCookies.for(accountId, request, this.secure))
      this.addCookie(reply, cookie);
  }

  private clearSession(reply: FastifyReply): void {
    this.addCookie(reply, clearCookie(SESSION_COOKIE, { secure: this.secure }));
    this.addCookie(reply, clearCookie(LEGACY_SESSION_COOKIE, { secure: this.secure }));
    // In demo mode a signed-out visitor would otherwise be signed straight back in.
    if (this.demo.enabled)
      this.addCookie(reply, serializeCookie(DEMO_OPT_OUT_COOKIE, '1', { secure: this.secure }));
  }

  private addCookie(reply: FastifyReply, cookie: string): void {
    const current = reply.getHeader('set-cookie');
    const list = current === undefined ? [] : Array.isArray(current) ? current : [String(current)];
    reply.header('set-cookie', [...list, cookie]);
  }

  /**
   * OAuth endpoints are browser navigations, so failures go back to the app as `?auth_error=`
   * instead of a JSON error page.
   */
  private async redirect(
    reply: FastifyReply,
    fallback: string,
    work: () => Promise<string>,
    onFailure?: (reason: string) => Promise<void>,
  ): Promise<void> {
    let location: string;
    try {
      location = await work();
    } catch (error) {
      if (!isDomainError(error))
        this.logger.error(error instanceof Error ? (error.stack ?? error.message) : error);
      const reason = isDomainError(error) ? error.message : 'Sign-in failed, please try again';
      await onFailure?.(reason);
      location = withError(fallback, reason);
    }
    await reply.code(302).header('location', location).send();
  }
}

function userAgent(request: FastifyRequest): string | null {
  return request.headers['user-agent'] ?? null;
}

function withError(path: string, message: string): string {
  const url = new URL(safeReturnTo(path), 'http://app');
  url.searchParams.set('auth_error', message);
  return `${url.pathname}${url.search}${url.hash}`;
}
