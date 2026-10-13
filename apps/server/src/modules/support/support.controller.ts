import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { isDomainError, NotFoundError, type Actor } from '@darkbeacon/core';
import type { EveSso } from '@darkbeacon/identity';
import {
  AdminSupportTicketsQuery,
  AdminSupportTicketUpdate,
  CreateSupportHandleRequest,
  CreateSupportTicketRequest,
  nestPath,
  routes,
  SaveSupportHandleRequest,
  SupportFeedbackRequest,
  SupportReplyRequest,
  SupportUnreadQuery,
  SupportWebhookRequest,
  type AdminSupportFeedbackDto,
  type AdminSupportInboxDto,
  type AdminSupportThreadDto,
  type SupportClientDto,
  type SupportHandleCreatedDto,
  type SupportHandleDto,
  type SupportSessionDto,
  type SupportThreadDto,
  type SupportTicketCreatedDto,
  type SupportTicketDto,
  type SupportUnreadDto,
} from '@darkbeacon/shared';
import { SupportClientService, type SupportHub, type SupportInbox } from '@darkbeacon/support';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ClientIp, CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { supportReturnTo, type HubSession, type SupportSessions } from './support-session.js';
import {
  SUPPORT_EVE_SSO,
  SUPPORT_HUB,
  SUPPORT_INBOX,
  SUPPORT_SESSIONS,
  SUPPORT_SETTINGS,
} from './support.tokens.js';
import type { SupportSettings } from './support.settings.js';

const LOGIN_TTL_MS = 10 * 60 * 1000;

/** Every instance: where the help menu goes, and the unread handle of the signed-in account. */
@Controller()
export class SupportClientController {
  constructor(@Inject(SupportClientService) private readonly client: SupportClientService) {}

  @Get(nestPath(routes.support.client.path))
  info(@CurrentActor() actor: Actor | null): Promise<SupportClientDto> {
    return this.client.client(actor);
  }

  @Put(nestPath(routes.support.saveHandle.path))
  @HttpCode(204)
  async saveHandle(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SaveSupportHandleRequest)) body: SaveSupportHandleRequest,
  ): Promise<void> {
    await this.client.saveHandle(actor, body);
  }

  @Delete(nestPath(routes.support.forgetHandle.path))
  @HttpCode(204)
  async forgetHandle(@CurrentActor() actor: Actor | null): Promise<void> {
    await this.client.forgetHandle(actor);
  }
}

/**
 * The support hub's pages talk to these: its own EVE sign-in (no scopes) and session, tickets,
 * feedback and unread handles. Nothing here answers unless the instance is a hub.
 */
@Controller()
export class SupportHubController {
  private readonly logger = new Logger('Support');

  constructor(
    @Inject(SUPPORT_HUB) private readonly hub: SupportHub | null,
    @Inject(SUPPORT_SESSIONS) private readonly sessions: SupportSessions,
    @Inject(SUPPORT_EVE_SSO) private readonly eve: EveSso | null,
    @Inject(SUPPORT_SETTINGS) private readonly settings: SupportSettings & { publicUrl: string },
  ) {}

  @Get(nestPath(routes.support.session.path))
  session(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): SupportSessionDto {
    void reply.header('cache-control', 'no-store');
    if (!this.hub) return { available: false, backend: null, feedback: false, character: null, csrf: null };
    const session = this.sessions.read(request);
    return {
      available: true,
      backend: this.hub.backend,
      feedback: this.hub.feedbackEnabled,
      character: session ? { id: session.identity.characterId, name: session.identity.characterName } : null,
      csrf: session?.csrf ?? null,
    };
  }

  @Get(nestPath(routes.support.login.path))
  async login(@Query('returnTo') returnTo: unknown, @Res() reply: FastifyReply): Promise<void> {
    const back = supportReturnTo(returnTo);
    if (!this.hub || !this.eve) return this.redirect(reply, withError(back, 'Support is not set up here'));
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    reply.header(
      'set-cookie',
      this.sessions.pendingCookie({ state, verifier, returnTo: back, expiresAt: Date.now() + LOGIN_TTL_MS }),
    );
    // Authentication only: no ESI scopes, no token is kept.
    const url = this.eve.authorizationUrl({
      state,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      redirectUri: this.callbackUrl,
      scopes: [],
    });
    return this.redirect(reply, url);
  }

  @Get(nestPath(routes.support.callback.path))
  async callback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pending = this.sessions.readPending(request);
    const cookies = [this.sessions.clearPending()];
    const back = pending?.returnTo ?? '/support';
    let location: string;
    try {
      if (!this.hub || !this.eve) throw new NotFoundError('Support');
      if (query.error) throw new Error('cancelled');
      if (!pending || !query.state || query.state !== pending.state || !query.code)
        throw new Error('The sign-in expired; try again');
      const tokens = await this.eve.exchangeCode({
        code: query.code,
        codeVerifier: pending.verifier,
        redirectUri: this.callbackUrl,
      });
      const identity = await this.hub.signIn(tokens.identity);
      cookies.push(this.sessions.sessionCookie(identity, randomBytes(24).toString('base64url')));
      location = back;
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'cancelled'
          ? 'Sign-in was cancelled'
          : isDomainError(error) || (error instanceof Error && error.message.startsWith('The sign-in'))
            ? (error as Error).message
            : 'Sign-in failed, please try again';
      if (!isDomainError(error) && !(error instanceof Error && /cancelled|expired/.test(error.message)))
        this.logger.warn(`support sign-in failed: ${String(error)}`);
      location = withError(back, message);
    }
    reply.header('set-cookie', cookies);
    return this.redirect(reply, location);
  }

  @Post(nestPath(routes.support.logout.path))
  @HttpCode(204)
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): void {
    this.sessions.checkOrigin(request);
    reply.header('set-cookie', this.sessions.clearSession());
  }

  @Get(nestPath(routes.support.tickets.path))
  tickets(@Req() request: FastifyRequest): Promise<SupportTicketDto[]> {
    const { hub, session } = this.signedIn(request, false);
    return hub.tickets(session.identity);
  }

  @Post(nestPath(routes.support.createTicket.path))
  createTicket(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(CreateSupportTicketRequest)) body: CreateSupportTicketRequest,
  ): Promise<SupportTicketCreatedDto> {
    const { hub, session } = this.signedIn(request, true);
    return hub.create(session.identity, body);
  }

  @Get(nestPath(routes.support.messages.path))
  thread(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string): Promise<SupportThreadDto> {
    const { hub, session } = this.signedIn(request, false);
    return hub.thread(session.identity, ticketId);
  }

  @Post(nestPath(routes.support.reply.path))
  @HttpCode(200)
  reply(
    @Req() request: FastifyRequest,
    @Param('ticketId') ticketId: string,
    @Body(new ZodPipe(SupportReplyRequest)) body: SupportReplyRequest,
  ): Promise<SupportThreadDto> {
    const { hub, session } = this.signedIn(request, true);
    return hub.reply(session.identity, ticketId, body.message);
  }

  @Post(nestPath(routes.support.markRead.path))
  @HttpCode(204)
  async markRead(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string): Promise<void> {
    const { hub, session } = this.signedIn(request, true);
    await hub.markRead(session.identity, ticketId);
  }

  @Post(nestPath(routes.support.feedback.path))
  @HttpCode(202)
  async feedback(
    @Req() request: FastifyRequest,
    @ClientIp() ip: string | null,
    @Body(new ZodPipe(SupportFeedbackRequest)) body: SupportFeedbackRequest,
  ): Promise<void> {
    const hub = this.requireHub();
    // Signed in: the session's token; anonymous: at least from the hub's own page.
    const session = this.sessions.read(request);
    if (session) this.sessions.require(request, true);
    else this.sessions.checkOrigin(request);
    await hub.feedback(session?.identity ?? null, body, ip);
  }

  @Post(nestPath(routes.support.createHandle.path))
  async createHandle(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(CreateSupportHandleRequest)) body: CreateSupportHandleRequest,
  ): Promise<SupportHandleCreatedDto> {
    const { hub, session } = this.signedIn(request, true);
    return { handle: await hub.createHandle(session.identity, body.origin) };
  }

  @Get(nestPath(routes.support.handles.path))
  handles(@Req() request: FastifyRequest): Promise<SupportHandleDto[]> {
    const { hub, session } = this.signedIn(request, false);
    return hub.handles(session.identity);
  }

  @Delete(nestPath(routes.support.revokeHandle.path))
  @HttpCode(204)
  async revokeHandle(@Req() request: FastifyRequest, @Param('handleId') handleId: string): Promise<void> {
    const { hub, session } = this.signedIn(request, true);
    await hub.revokeHandle(session.identity, handleId);
  }

  @Get(nestPath(routes.support.unread.path))
  async unread(
    @Req() request: FastifyRequest,
    @Query(new ZodPipe(SupportUnreadQuery)) query: SupportUnreadQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SupportUnreadDto> {
    const hub = this.requireHub();
    void reply.header('cache-control', 'no-store');
    if (query.h) {
      const origin = request.headers.origin;
      return { unread: await hub.unreadForHandle(query.h, typeof origin === 'string' ? origin : null) };
    }
    // Without a handle: the hub's own pages, with the hub session (same origin only).
    const session = this.sessions.read(request);
    if (
      !session ||
      (request.headers.origin && request.headers.origin !== new URL(this.settings.publicUrl).origin)
    )
      return { unread: 0 };
    return { unread: await hub.unread(session.identity) };
  }

  @Post(nestPath(routes.support.webhook.path))
  @HttpCode(204)
  webhook(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(SupportWebhookRequest)) body: SupportWebhookRequest,
  ): void {
    const hub = this.requireHub();
    const secret = this.settings.hub?.webhookSecret;
    const sent = request.headers['x-support-webhook-secret'];
    if (!secret || typeof sent !== 'string' || !equal(sent, secret)) throw new NotFoundError('Webhook');
    hub.replyPosted(body.distinct_id);
  }

  private get callbackUrl(): string {
    return `${this.settings.publicUrl}/support/callback`;
  }

  private requireHub(): SupportHub {
    if (!this.hub) throw new NotFoundError('Support');
    return this.hub;
  }

  private signedIn(request: FastifyRequest, change: boolean): { hub: SupportHub; session: HubSession } {
    const hub = this.requireHub();
    return { hub, session: this.sessions.require(request, change) };
  }

  private async redirect(reply: FastifyReply, location: string): Promise<void> {
    await reply.code(302).header('cache-control', 'no-store').header('location', location).send();
  }
}

/** The hub's instance admins answer tickets here when it keeps them itself. */
@Controller()
export class SupportAdminController {
  constructor(@Inject(SUPPORT_INBOX) private readonly inbox: SupportInbox | null) {}

  @Get(nestPath(routes.support.adminTickets.path))
  list(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(AdminSupportTicketsQuery)) query: AdminSupportTicketsQuery,
  ): Promise<AdminSupportInboxDto> {
    return this.requireInbox().list(actor, query);
  }

  @Get(nestPath(routes.support.adminTicket.path))
  thread(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
  ): Promise<AdminSupportThreadDto> {
    return this.requireInbox().thread(actor, ticketId);
  }

  @Post(nestPath(routes.support.adminReply.path))
  @HttpCode(200)
  answer(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
    @Body(new ZodPipe(SupportReplyRequest)) body: SupportReplyRequest,
  ): Promise<AdminSupportThreadDto> {
    return this.requireInbox().answer(actor, ticketId, body.message);
  }

  @Patch(nestPath(routes.support.adminUpdate.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
    @Body(new ZodPipe(AdminSupportTicketUpdate)) body: AdminSupportTicketUpdate,
  ): Promise<AdminSupportThreadDto> {
    return this.requireInbox().update(actor, ticketId, body);
  }

  @Get(nestPath(routes.support.adminFeedback.path))
  feedback(@CurrentActor() actor: Actor | null): Promise<AdminSupportFeedbackDto[]> {
    return this.requireInbox().feedback(actor);
  }

  private requireInbox(): SupportInbox {
    if (!this.inbox) throw new NotFoundError('Support inbox');
    return this.inbox;
  }
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function withError(path: string, message: string): string {
  const url = new URL(path, 'http://hub.invalid');
  url.searchParams.set('support_error', message);
  return `${url.pathname}${url.search}`;
}
