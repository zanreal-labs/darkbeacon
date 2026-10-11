import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '@wormwright/core';
import { AccountService, CharacterService } from '@wormwright/identity';
import {
  EveId,
  nestPath,
  routes,
  TransferOwnershipRequest,
  UpdateInstanceRoleRequest,
  type AdminAccountDto,
  type MeDto,
} from '@wormwright/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

@Controller()
export class AccountsController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CharacterService) private readonly characters: CharacterService,
  ) {}

  @Get(nestPath(routes.accounts.me.path))
  me(@CurrentActor() actor: Actor | null): Promise<MeDto> {
    return this.accounts.me(actor);
  }

  @Delete(nestPath(routes.accounts.unlinkCharacter.path))
  @HttpCode(204)
  unlinkCharacter(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<void> {
    return this.characters.unlink(actor, characterId);
  }
}

@Controller()
export class AdminAccountsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

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
}
