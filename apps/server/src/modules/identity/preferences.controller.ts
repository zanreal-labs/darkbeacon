import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { CharacterWallets, UserPreferences } from '@darkbeacon/identity';
import {
  EveId,
  nestPath,
  routes,
  UpdateUserPreferencesRequest,
  type CharacterWalletDto,
  type UserPreferencesDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

/** My preferences that follow me between browsers, and my characters' wallets. */
@Controller()
export class PreferencesController {
  constructor(
    @Inject(UserPreferences) private readonly preferences: UserPreferences,
    @Inject(CharacterWallets) private readonly wallets: CharacterWallets,
  ) {}

  @Get(nestPath(routes.characters.preferences.path))
  get(@CurrentActor() actor: Actor | null): Promise<UserPreferencesDto> {
    return this.preferences.get(actor);
  }

  @Put(nestPath(routes.characters.updatePreferences.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(UpdateUserPreferencesRequest)) body: UpdateUserPreferencesRequest,
  ): Promise<UserPreferencesDto> {
    return this.preferences.update(actor, body);
  }

  @Get(nestPath(routes.characters.wallet.path))
  wallet(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<CharacterWalletDto> {
    return this.wallets.balance(actor, characterId);
  }
}
