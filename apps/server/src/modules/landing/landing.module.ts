import { Controller, Get, Inject, Module } from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import { requireAccount, type Actor } from '@darkbeacon/core';
import { AccountService, chooseLanding, DiscordBotService } from '@darkbeacon/identity';
import { MapUseCases } from '@darkbeacon/mapping';
import { nestPath, routes, type InstanceInfoDto, type LandingDto } from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { MappingModule } from '../mapping/mapping.module.js';

/**
 * Where `/` goes and what signed-in pages need to know about the instance. Composes identity
 * (the account's star and recent maps), access (the instance default, login method) and mapping
 * (the maps the account can see).
 */
@Controller()
export class LandingController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
    @Inject(MapUseCases) private readonly maps: MapUseCases,
    @Inject(DiscordBotService) private readonly bot: DiscordBotService,
  ) {}

  @Get(nestPath(routes.accounts.landing.path))
  async landing(@CurrentActor() actor: Actor | null): Promise<LandingDto> {
    requireAccount(actor);
    const [maps, prefs, settings] = await Promise.all([
      this.maps.list(actor),
      this.accounts.mapPreferences(actor),
      this.settings.current(),
    ]);
    const chosen = chooseLanding({
      maps,
      accountDefault: prefs.defaultMapId,
      instanceDefault: settings.defaultMapId,
      recent: prefs.recentMapIds,
    });
    return chosen ? { slug: chosen.map.slug, reason: chosen.reason } : { slug: null, reason: null };
  }

  @Get(nestPath(routes.instance.info.path))
  async info(@CurrentActor() actor: Actor | null): Promise<InstanceInfoDto> {
    requireAccount(actor);
    const [settings, loginMethod, discordBot] = await Promise.all([
      this.settings.current(),
      this.settings.loginMethod(),
      this.bot.configured(),
    ]);
    return {
      defaultMapId: settings.defaultMapId ?? null,
      loginMethod,
      discordRoles: loginMethod === 'discord',
      discordBot,
      publicMaps: settings.publicMaps ?? true,
      mcpMode: settings.mcpMode ?? 'off',
      mapCreation: settings.mapCreation ?? 'everyone',
    };
  }
}

@Module({ imports: [MappingModule], controllers: [LandingController] })
export class LandingModule {}
