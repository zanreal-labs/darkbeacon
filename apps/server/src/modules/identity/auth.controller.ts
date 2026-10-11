import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { isDomainError, requireAccount, type Actor } from '@wormwright/core';
import {
  AccountService,
  CharacterService,
  DevLogin,
  DiscordLogin,
  safeReturnTo,
  SESSION_TTL_MS,
  SessionService,
  type PendingAuth,
} from '@wormwright/identity';
import { DevLoginRequest, nestPath, routes, type AuthProvidersDto, type MeDto } from '@wormwright/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SecretBox } from '../../adapters/identity/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { APP_CONFIG } from '../../platform/tokens.js';
import {
  clearCookie,
  openPending,
  PENDING_COOKIE,
  readCookie,
  sealPending,
  serializeCookie,
  SESSION_COOKIE,
} from './cookies.js';
import { PENDING_BOX } from './identity.tokens.js';

type CallbackQuery = { code?: string; state?: string; error?: string };

const PENDING_PATH = '/api/auth';

@Controller()
export class AuthController {
  private readonly logger = new Logger('Auth');
  private readonly secure: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PENDING_BOX) private readonly box: SecretBox,
    @Inject(DiscordLogin) private readonly discord: DiscordLogin,
    @Inject(DevLogin) private readonly dev: DevLogin,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {
    this.secure = config.publicUrl.startsWith('https://');
  }

  @Get(nestPath(routes.auth.providers.path))
  providers(): AuthProvidersDto {
    return { discord: this.discord.enabled, eve: this.characters.enabled, dev: this.dev.enabled };
  }

  @Get(nestPath(routes.auth.discordLogin.path))
  async discordLogin(@Query('returnTo') returnTo: unknown, @Res() reply: FastifyReply): Promise<void> {
    await this.redirect(reply, '/', async () => this.begin(reply, await this.discord.start(returnTo)));
  }

  @Get(nestPath(routes.auth.discordCallback.path))
  async discordCallback(
    @Query() query: CallbackQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pending = this.takePending(request, reply);
    await this.redirect(reply, pending?.returnTo ?? '/', async () => {
      if (query.error) return withError(pending?.returnTo ?? '/', 'Discord sign-in was cancelled');
      const signedIn = await this.discord.complete({
        code: query.code,
        state: query.state,
        pending,
        userAgent: userAgent(request),
      });
      this.setSession(reply, signedIn.token);
      return signedIn.returnTo;
    });
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
    await this.redirect(reply, pending?.returnTo ?? '/', async () => {
      if (query.error) return withError(pending?.returnTo ?? '/', 'EVE sign-in was cancelled');
      const linked = await this.characters.completeLink(actor, {
        code: query.code,
        state: query.state,
        pending,
      });
      return linked.returnTo;
    });
  }

  @Post(nestPath(routes.auth.dev.path))
  @HttpCode(200)
  async devLogin(
    @Body(new ZodPipe(DevLoginRequest)) body: DevLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeDto> {
    const signedIn = await this.dev.signIn(body, userAgent(request));
    this.setSession(reply, signedIn.token);
    return this.accounts.me(await this.accounts.actorFor(signedIn.account));
  }

  @Post(nestPath(routes.auth.logout.path))
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.logout(readCookie(request, SESSION_COOKIE));
    reply.header('set-cookie', clearCookie(SESSION_COOKIE, { secure: this.secure }));
  }

  @Post(nestPath(routes.auth.logoutEverywhere.path))
  @HttpCode(204)
  async logoutEverywhere(
    @CurrentActor() actor: Actor | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.logoutEverywhere(requireAccount(actor).id);
    reply.header('set-cookie', clearCookie(SESSION_COOKIE, { secure: this.secure }));
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

  private setSession(reply: FastifyReply, token: string): void {
    this.addCookie(
      reply,
      serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000, secure: this.secure }),
    );
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
  private async redirect(reply: FastifyReply, fallback: string, work: () => Promise<string>): Promise<void> {
    let location: string;
    try {
      location = await work();
    } catch (error) {
      if (!isDomainError(error))
        this.logger.error(error instanceof Error ? (error.stack ?? error.message) : error);
      location = withError(
        fallback,
        isDomainError(error) ? error.message : 'Sign-in failed, please try again',
      );
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
