import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { AccountService, CharacterService, SessionService, SignUpGate } from '@darkbeacon/identity';
import {
  CreateInviteRequest,
  EveId,
  nestPath,
  routes,
  SetAccountDisabledRequest,
  type AdminAccountDto,
  type AdminCharacterDto,
  type CreatedInviteDto,
  type InviteDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { APP_CONFIG } from '../../platform/tokens.js';

const r = routes.adminIdentity;

/** Instance admins: every character, disabling accounts, invite links. */
@Controller()
export class AdminIdentityController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SignUpGate) private readonly signUp: SignUpGate,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(nestPath(r.characters.path))
  async listCharacters(@CurrentActor() actor: Actor | null): Promise<AdminCharacterDto[]> {
    const linked = await this.characters.adminList(actor);
    const names = await this.accounts.names(linked.map((c) => c.accountId));
    return linked.map((c) => ({
      id: c.id,
      name: c.name,
      corporationId: c.corporationId,
      allianceId: c.allianceId,
      accountId: c.accountId,
      accountName: names.get(c.accountId)?.name ?? null,
      tokenValid: c.tokenValid,
      linkedAt: c.linkedAt,
    }));
  }

  @Delete(nestPath(r.unlinkCharacter.path))
  @HttpCode(204)
  unlink(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<void> {
    return this.characters.adminUnlink(actor, characterId);
  }

  @Put(nestPath(r.setDisabled.path))
  async setDisabled(
    @CurrentActor() actor: Actor | null,
    @Param('accountId') accountId: string,
    @Body(new ZodPipe(SetAccountDisabledRequest)) body: SetAccountDisabledRequest,
  ): Promise<AdminAccountDto> {
    const account = await this.accounts.setDisabled(actor, accountId, body.disabled, body.reason ?? null);
    // Its sessions end now (they would no longer resolve anyway).
    if (body.disabled) await this.sessions.logoutEverywhere(accountId);
    return account;
  }

  @Get(nestPath(r.invites.path))
  invites(@CurrentActor() actor: Actor | null): Promise<InviteDto[]> {
    return this.signUp.listInvites(actor);
  }

  @Post(nestPath(r.createInvite.path))
  async createInvite(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(CreateInviteRequest)) body: CreateInviteRequest,
  ): Promise<CreatedInviteDto> {
    const { invite, token } = await this.signUp.createInvite(actor, body);
    return { invite, token, url: `${this.config.publicUrl}/login?invite=${token}` };
  }

  @Delete(nestPath(r.revokeInvite.path))
  @HttpCode(204)
  revokeInvite(@CurrentActor() actor: Actor | null, @Param('inviteId') inviteId: string): Promise<void> {
    return this.signUp.revokeInvite(actor, inviteId);
  }
}
