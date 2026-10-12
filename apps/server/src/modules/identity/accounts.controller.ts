import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { actorRef, requireAccount, type Actor } from '@darkbeacon/core';
import { AccountService, CharacterService, DiscordBotService, SessionService } from '@darkbeacon/identity';
import {
  AccountSearchQuery,
  EveId,
  nestPath,
  RecordMapOpenedRequest,
  routes,
  SetDefaultMapRequest,
  SetDiscordBotRequest,
  SetMainCharacterRequest,
  TransferOwnershipRequest,
  UpdateInstanceRoleRequest,
  type AccountSummaryDto,
  type AdminAccountDto,
  type DiscordBotDto,
  type MeDto,
  type SessionDto,
} from '@darkbeacon/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { readSessionCookie } from './cookies.js';
import { PickerAccess } from './picker-access.js';
import { SignInAudit } from './sign-in-audit.js';

@Controller()
export class AccountsController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PickerAccess) private readonly pickers: PickerAccess,
    @Inject(SignInAudit) private readonly audit: SignInAudit,
  ) {}

  @Get(nestPath(routes.accounts.me.path))
  me(@CurrentActor() actor: Actor | null): Promise<MeDto> {
    return this.accounts.me(actor);
  }

  @Put(nestPath(routes.accounts.setMainCharacter.path))
  setMainCharacter(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetMainCharacterRequest)) body: SetMainCharacterRequest,
  ): Promise<MeDto> {
    return this.accounts.setMainCharacter(actor, body.characterId);
  }

  @Delete(nestPath(routes.accounts.unlinkCharacter.path))
  @HttpCode(204)
  unlinkCharacter(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<void> {
    return this.characters.unlink(actor, characterId);
  }

  @Put(nestPath(routes.accounts.setDefaultMap.path))
  setDefaultMap(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetDefaultMapRequest)) body: SetDefaultMapRequest,
  ): Promise<MeDto> {
    return this.accounts.setDefaultMap(actor, body.mapId);
  }

  @Put(nestPath(routes.accounts.recordMapOpened.path))
  @HttpCode(204)
  recordMapOpened(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(RecordMapOpenedRequest)) body: RecordMapOpenedRequest,
  ): Promise<void> {
    return this.accounts.recordMapOpened(actor, body.mapId);
  }

  @Get(nestPath(routes.accounts.sessions.path))
  sessionList(@CurrentActor() actor: Actor | null, @Req() request: FastifyRequest): Promise<SessionDto[]> {
    return this.sessions.list(requireAccount(actor).id, readSessionCookie(request));
  }

  @Delete(nestPath(routes.accounts.revokeSession.path))
  @HttpCode(204)
  async revokeSession(
    @CurrentActor() actor: Actor | null,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    const { id } = requireAccount(actor);
    const session = (await this.sessions.list(id, null)).find((s) => s.id === sessionId);
    await this.sessions.revoke(id, sessionId);
    const device =
      session && (session.browser || session.os)
        ? [session.browser, session.os].filter(Boolean).join(' on ')
        : null;
    await this.audit.signedOut(id, false, device);
  }

  @Delete(nestPath(routes.accounts.disconnectDiscord.path))
  @HttpCode(204)
  async disconnectDiscord(@CurrentActor() actor: Actor | null): Promise<void> {
    const before = await this.accounts.me(actor);
    await this.accounts.disconnectDiscord(actor);
    if (before.account.discordId) await this.audit.discordChanged(before.account.id, false);
  }

  @Get(nestPath(routes.accounts.search.path))
  async search(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(AccountSearchQuery)) query: AccountSearchQuery,
  ): Promise<AccountSummaryDto[]> {
    await this.pickers.require(actor);
    return this.accounts.search(query.q);
  }
}

@Controller()
export class AdminAccountsController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(DiscordBotService) private readonly bot: DiscordBotService,
    @Inject(SignInAudit) private readonly audit: SignInAudit,
  ) {}

  @Get(nestPath(routes.admin.accounts.path))
  list(@CurrentActor() actor: Actor | null): Promise<AdminAccountDto[]> {
    return this.accounts.list(actor);
  }

  @Put(nestPath(routes.admin.setInstanceRole.path))
  setRole(
    @CurrentActor() actor: Actor | null,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(UpdateInstanceRoleRequest)) body: UpdateInstanceRoleRequest,
  ): Promise<AdminAccountDto> {
    return this.accounts.setRole(actor, accountId, body.role);
  }

  @Post(nestPath(routes.admin.transferOwnership.path))
  @HttpCode(204)
  transferOwnership(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(TransferOwnershipRequest)) body: TransferOwnershipRequest,
  ): Promise<void> {
    return this.accounts.transferOwnership(actor, body.accountId);
  }

  @Get(nestPath(routes.admin.discordBot.path))
  discordBot(@CurrentActor() actor: Actor | null): Promise<DiscordBotDto> {
    return this.bot.status(actor);
  }

  @Put(nestPath(routes.admin.setDiscordBot.path))
  async setDiscordBot(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetDiscordBotRequest)) body: SetDiscordBotRequest,
  ): Promise<DiscordBotDto> {
    const before = await this.bot.status(actor);
    const after = await this.bot.connect(actor, body.token);
    await this.audit.botChanged(actorRef(actor!), botFacts(before), botFacts(after));
    return after;
  }

  @Delete(nestPath(routes.admin.removeDiscordBot.path))
  @HttpCode(204)
  async removeDiscordBot(@CurrentActor() actor: Actor | null): Promise<void> {
    const before = await this.bot.status(actor);
    await this.bot.disconnect(actor);
    if (before.configured) await this.audit.botChanged(actorRef(actor!), botFacts(before), botFacts(null));
  }
}

/** What the audit trail keeps of the bot: whether there is one and its name, never the token. */
function botFacts(bot: DiscordBotDto | null): { configured: boolean; name: string | null } {
  return { configured: bot?.configured ?? false, name: bot?.configured ? bot.name : null };
}
