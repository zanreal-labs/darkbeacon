import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { AccessRules, InstanceSettingsService } from '@darkbeacon/access';
import type { Actor } from '@darkbeacon/core';
import {
  CopyAccessRulesRequest,
  UpdateAccessRuleRequest,
  type CopyAccessRulesResultDto,
  CreateAccessRuleRequest,
  nestPath,
  routes,
  UpdateInstanceSettingsRequest,
  type AccessRuleDto,
  type InstanceSettingsDto,
} from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

@Controller()
export class AccessRulesController {
  constructor(@Inject(AccessRules) private readonly rules: AccessRules) {}

  @Get(nestPath(routes.access.list.path))
  list(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<AccessRuleDto[]> {
    return this.rules.list(actor, mapId);
  }

  @Post(nestPath(routes.access.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(CreateAccessRuleRequest)) body: CreateAccessRuleRequest,
  ): Promise<AccessRuleDto> {
    return this.rules.add(actor, mapId, body);
  }

  @Patch(nestPath(routes.accessRules.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodPipe(UpdateAccessRuleRequest)) body: UpdateAccessRuleRequest,
  ): Promise<AccessRuleDto> {
    return this.rules.update(actor, mapId, ruleId, body.role);
  }

  @Post(nestPath(routes.accessRules.copy.path))
  @HttpCode(200)
  copy(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(CopyAccessRulesRequest)) body: CopyAccessRulesRequest,
  ): Promise<CopyAccessRulesResultDto> {
    return this.rules.copyFrom(actor, mapId, body.fromMapId, body.overwrite);
  }

  @Delete(nestPath(routes.access.remove.path))
  @HttpCode(204)
  remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('ruleId') ruleId: string,
  ): Promise<void> {
    return this.rules.remove(actor, mapId, ruleId);
  }
}

@Controller()
export class InstanceSettingsController {
  constructor(@Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService) {}

  @Get(nestPath(routes.admin.settings.path))
  get(@CurrentActor() actor: Actor | null): Promise<InstanceSettingsDto> {
    return this.settings.get(actor);
  }

  @Patch(nestPath(routes.admin.updateSettings.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(UpdateInstanceSettingsRequest)) body: UpdateInstanceSettingsRequest,
  ): Promise<InstanceSettingsDto> {
    return this.settings.update(actor, body);
  }
}
