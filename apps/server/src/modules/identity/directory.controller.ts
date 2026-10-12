import { Controller, Get, Inject, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { requireAccount, type Actor } from '@darkbeacon/core';
import { DiscordBotService, EsiUnavailableError, EveDirectoryService } from '@darkbeacon/identity';
import {
  EveEntitiesQuery,
  EveSearchQuery,
  nestPath,
  routes,
  type DiscordChannelDto,
  type DiscordGuildDto,
  type DiscordRoleDto,
  type EveEntityDto,
  type EveSearchResultDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { PickerAccess } from './picker-access.js';

const Snowflake = z.string().regex(/^\d{1,20}$/);

/** ESI being unavailable is a 503 the pickers show as "try again", not a server error. */
async function esi<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof EsiUnavailableError) throw new ServiceUnavailableException(error.message);
    throw error;
  }
}

/** Names for pickers: EVE characters, corporations and alliances (ESI). */
@Controller()
export class EveDirectoryController {
  constructor(@Inject(EveDirectoryService) private readonly directory: EveDirectoryService) {}

  @Get(nestPath(routes.eve.search.path))
  search(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(EveSearchQuery)) query: EveSearchQuery,
  ): Promise<EveSearchResultDto> {
    return esi(this.directory.search(actor, query.category, query.q));
  }

  @Get(nestPath(routes.eve.entities.path))
  entities(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(EveEntitiesQuery)) query: EveEntitiesQuery,
  ): Promise<EveEntityDto[]> {
    requireAccount(actor);
    return esi(this.directory.entities(query.ids));
  }
}

/** Discord servers, roles and channels the instance bot sees (map and instance admins). */
@Controller()
export class DiscordDirectoryController {
  constructor(
    @Inject(DiscordBotService) private readonly bot: DiscordBotService,
    @Inject(PickerAccess) private readonly pickers: PickerAccess,
  ) {}

  @Get(nestPath(routes.discord.guilds.path))
  async guilds(@CurrentActor() actor: Actor | null): Promise<DiscordGuildDto[]> {
    await this.pickers.require(actor);
    return this.bot.guilds();
  }

  @Get(nestPath(routes.discord.roles.path))
  async roles(
    @CurrentActor() actor: Actor | null,
    @Param('guildId', new ZodPipe(Snowflake)) guildId: string,
  ): Promise<DiscordRoleDto[]> {
    await this.pickers.require(actor);
    return this.bot.roles(guildId);
  }

  @Get(nestPath(routes.discord.channels.path))
  async channels(
    @CurrentActor() actor: Actor | null,
    @Param('guildId', new ZodPipe(Snowflake)) guildId: string,
  ): Promise<DiscordChannelDto[]> {
    await this.pickers.require(actor);
    return this.bot.channels(guildId);
  }
}
