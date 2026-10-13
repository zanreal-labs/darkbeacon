import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ForbiddenError, NotFoundError, requireAccount, type Actor } from '@darkbeacon/core';
import {
  AdminSupportTicketsQuery,
  AdminSupportTicketUpdate,
  CreateSupportHandleRequest,
  CreateSupportTicketRequest,
  nestPath,
  routes,
  SaveSupportHandleRequest,
  SupportCharacterQuery,
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
  type SupportTicketGroupDto,
  type SupportUnreadDto,
} from '@darkbeacon/shared';
import { SupportClientService, type SupportHub, type SupportInbox } from '@darkbeacon/support';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ClientIp, CurrentActor, sameOrigin } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { SUPPORT_HUB, SUPPORT_INBOX, SUPPORT_SETTINGS } from './support.tokens.js';
import type { SupportSettings } from './support.settings.js';

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
 * The support hub's pages talk to these: tickets, feedback and unread handles. Pilots are signed
 * in with the app's own session (the actor guard reads the session cookie only on requests from
 * the instance's own pages, and the cookie is SameSite=Lax), and act as one of their account's EVE
 * characters. Nothing here answers unless the instance is a hub.
 */
@Controller()
export class SupportHubController {
  private readonly publicOrigin: string;

  constructor(
    @Inject(SUPPORT_HUB) private readonly hub: SupportHub | null,
    @Inject(SUPPORT_SETTINGS) private readonly settings: SupportSettings & { publicUrl: string },
  ) {
    this.publicOrigin = new URL(settings.publicUrl).origin;
  }

  @Get(nestPath(routes.support.session.path))
  async session(
    @CurrentActor() actor: Actor | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SupportSessionDto> {
    void reply.header('cache-control', 'no-store');
    if (!this.hub)
      return { available: false, backend: null, feedback: false, signedIn: false, characters: [] };
    const account = sessionAccount(actor);
    const characters = account ? await this.hub.characters(account) : [];
    return {
      available: true,
      backend: this.hub.backend,
      feedback: this.hub.feedbackEnabled,
      signedIn: account !== null,
      characters: characters.map((c) => ({ id: c.characterId, name: c.characterName, main: c.main })),
    };
  }

  @Get(nestPath(routes.support.tickets.path))
  tickets(@CurrentActor() actor: Actor | null): Promise<SupportTicketGroupDto[]> {
    const { hub, accountId } = this.signedIn(actor);
    return hub.ticketGroups(accountId);
  }

  @Post(nestPath(routes.support.createTicket.path))
  async createTicket(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(CreateSupportTicketRequest)) body: CreateSupportTicketRequest,
  ): Promise<SupportTicketCreatedDto> {
    const { hub, accountId } = this.signedIn(actor);
    const { characterId, ...ticket } = body;
    return hub.create(await hub.identity(accountId, characterId), ticket);
  }

  @Get(nestPath(routes.support.messages.path))
  async thread(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
    @Query(new ZodPipe(SupportCharacterQuery)) query: SupportCharacterQuery,
  ): Promise<SupportThreadDto> {
    const { hub, accountId } = this.signedIn(actor);
    return hub.thread(await hub.identity(accountId, query.character), ticketId);
  }

  @Post(nestPath(routes.support.reply.path))
  @HttpCode(200)
  async reply(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
    @Query(new ZodPipe(SupportCharacterQuery)) query: SupportCharacterQuery,
    @Body(new ZodPipe(SupportReplyRequest)) body: SupportReplyRequest,
  ): Promise<SupportThreadDto> {
    const { hub, accountId } = this.signedIn(actor);
    return hub.reply(await hub.identity(accountId, query.character), ticketId, body.message);
  }

  @Post(nestPath(routes.support.markRead.path))
  @HttpCode(204)
  async markRead(
    @CurrentActor() actor: Actor | null,
    @Param('ticketId') ticketId: string,
    @Query(new ZodPipe(SupportCharacterQuery)) query: SupportCharacterQuery,
  ): Promise<void> {
    const { hub, accountId } = this.signedIn(actor);
    await hub.markRead(await hub.identity(accountId, query.character), ticketId);
  }

  @Post(nestPath(routes.support.feedback.path))
  @HttpCode(202)
  async feedback(
    @CurrentActor() actor: Actor | null,
    @Req() request: FastifyRequest,
    @ClientIp() ip: string | null,
    @Body(new ZodPipe(SupportFeedbackRequest)) body: SupportFeedbackRequest,
  ): Promise<void> {
    const hub = this.requireHub();
    // Signed in: as the main character (anonymous for an account without one). Anonymous: at
    // least from the hub's own page.
    const account = sessionAccount(actor);
    if (!account && (!request.headers.origin || !sameOrigin(request.headers, this.publicOrigin)))
      throw new ForbiddenError('Send this from the support page');
    const identity =
      account && (await hub.characters(account)).length > 0 ? await hub.identity(account) : null;
    await hub.feedback(identity, body, ip);
  }

  @Post(nestPath(routes.support.createHandle.path))
  async createHandle(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(CreateSupportHandleRequest)) body: CreateSupportHandleRequest,
  ): Promise<SupportHandleCreatedDto> {
    const { hub, accountId } = this.signedIn(actor);
    return { handle: await hub.createHandle(accountId, body.origin) };
  }

  @Get(nestPath(routes.support.handles.path))
  handles(@CurrentActor() actor: Actor | null): Promise<SupportHandleDto[]> {
    const { hub, accountId } = this.signedIn(actor);
    return hub.handles(accountId);
  }

  @Delete(nestPath(routes.support.revokeHandle.path))
  @HttpCode(204)
  async revokeHandle(
    @CurrentActor() actor: Actor | null,
    @Param('handleId') handleId: string,
  ): Promise<void> {
    const { hub, accountId } = this.signedIn(actor);
    await hub.revokeHandle(accountId, handleId);
  }

  @Get(nestPath(routes.support.unread.path))
  async unread(
    @CurrentActor() actor: Actor | null,
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
    // Without a handle: the hub's own pages, with the app session (the guard ignores the cookie
    // on a request from another origin).
    const account = sessionAccount(actor);
    return { unread: account ? await hub.unreadOfAccount(account) : 0 };
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

  private requireHub(): SupportHub {
    if (!this.hub) throw new NotFoundError('Support');
    return this.hub;
  }

  /** The hub, and the account of the app session (401 without one). */
  private signedIn(actor: Actor | null): { hub: SupportHub; accountId: string } {
    const hub = this.requireHub();
    const account = requireAccount(actor);
    if (account.grant) throw new ForbiddenError('Support needs a browser session');
    return { hub, accountId: account.id };
  }
}

/** The account of a browser session, or null (anonymous, or an API key). */
function sessionAccount(actor: Actor | null): string | null {
  return actor?.kind === 'account' && !actor.grant ? actor.id : null;
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
