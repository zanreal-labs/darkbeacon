import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '@wormwright/core';
import { ThemeAdmin, parsePackageSource, type InstalledTheme, type ThemeOverview } from '@wormwright/plugins';
import {
  InstallPluginRequest,
  SelectThemeRequest,
  SetDefaultThemeRequest,
  nestPath,
  routes,
  type ThemeDto,
  type ThemesDto,
} from '@wormwright/shared';
import { builtInThemes, resolveTheme, type ThemeManifest } from '@wormwright/theme-sdk';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { uploadedPackage } from './plugins.controller.js';

const r = routes.themes;

const builtIn: ThemeDto[] = builtInThemes.map((t) => ({
  id: t.id,
  name: t.name,
  version: null,
  colorScheme: t.colorScheme,
  builtIn: true,
  tokens: t.tokens,
}));

/** An installed theme with every token resolved over its base theme. */
function toThemeDto(theme: InstalledTheme): ThemeDto {
  const resolved = resolveTheme({ ...theme, extends: theme.extends as ThemeManifest['extends'] });
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version,
    colorScheme: theme.colorScheme,
    builtIn: false,
    tokens: resolved.tokens,
  };
}

function toThemesDto(overview: ThemeOverview): ThemesDto {
  return {
    themes: [...builtIn, ...overview.installed.map(toThemeDto)],
    defaultThemeId: overview.defaultThemeId,
    selectedThemeId: overview.selectedThemeId,
  };
}

@Controller()
export class ThemesController {
  constructor(@Inject(ThemeAdmin) private readonly themes: ThemeAdmin) {}

  @Get(nestPath(r.list.path))
  async list(@CurrentActor() actor: Actor | null): Promise<ThemesDto> {
    return toThemesDto(await this.themes.overview(actor));
  }

  @Put(nestPath(r.select.path))
  async select(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SelectThemeRequest)) body: SelectThemeRequest,
  ): Promise<ThemesDto> {
    return toThemesDto(await this.themes.select(actor, body.themeId));
  }

  @Put(nestPath(r.setDefault.path))
  async setDefault(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetDefaultThemeRequest)) body: SetDefaultThemeRequest,
  ): Promise<ThemesDto> {
    return toThemesDto(await this.themes.setDefault(actor, body.themeId));
  }

  @Post(nestPath(r.install.path))
  async install(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(InstallPluginRequest)) body: InstallPluginRequest,
  ): Promise<ThemeDto> {
    return toThemeDto(await this.themes.install(actor, parsePackageSource(body.source)));
  }

  @Post(nestPath(r.upload.path))
  async upload(@CurrentActor() actor: Actor | null, @Body() body: unknown): Promise<ThemeDto> {
    return toThemeDto(await this.themes.install(actor, { kind: 'upload', data: uploadedPackage(body) }));
  }

  @Delete(nestPath(r.uninstall.path))
  @HttpCode(204)
  async uninstall(@CurrentActor() actor: Actor | null, @Param('themeId') themeId: string): Promise<void> {
    await this.themes.uninstall(actor, themeId);
  }
}
