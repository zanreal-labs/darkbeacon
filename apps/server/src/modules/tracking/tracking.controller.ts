import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { AccountService } from '@darkbeacon/identity';
import {
  EveId,
  nestPath,
  routes,
  SetTrackingRequest,
  type CharacterPresenceDto,
  type MapTrackedCharacterDto,
} from '@darkbeacon/shared';
import { ListMapCharacters, ManageMapTracking, SetTracking } from '@darkbeacon/tracking';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { OfflineVisibility } from './offline-visibility.js';

@Controller()
export class TrackingController {
  constructor(
    @Inject(SetTracking) private readonly setTracking: SetTracking,
    @Inject(ListMapCharacters) private readonly listCharacters: ListMapCharacters,
    @Inject(ManageMapTracking) private readonly manage: ManageMapTracking,
    @Inject(OfflineVisibility) private readonly offline: OfflineVisibility,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Get(nestPath(routes.tracking.characters.path))
  async characters(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
  ): Promise<CharacterPresenceDto[]> {
    return this.offline.filterList(actor, mapId, await this.listCharacters.execute(actor, mapId));
  }

  @Put(nestPath(routes.tracking.set.path))
  @HttpCode(204)
  async set(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetTrackingRequest)) body: SetTrackingRequest,
  ): Promise<void> {
    await this.setTracking.execute(actor, mapId, body);
  }

  @Get(nestPath(routes.mapCharacters.list.path))
  async tracked(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
  ): Promise<MapTrackedCharacterDto[]> {
    const list = await this.manage.list(actor, mapId);
    const names = await this.accounts.names(list.map((c) => c.accountId));
    return list.map((c) => ({ ...c, accountName: names.get(c.accountId)?.name ?? null }));
  }

  @Delete(nestPath(routes.mapCharacters.untrack.path))
  @HttpCode(204)
  untrack(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<void> {
    return this.manage.untrack(actor, mapId, characterId);
  }
}
