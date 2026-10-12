import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiKeys } from '@darkbeacon/api-keys';
import type { Actor } from '@darkbeacon/core';
import {
  CreateApiKeyRequest,
  CreateServiceKeyRequest,
  UpdateApiKeyRequest,
  nestPath,
  routes,
  type ApiKeyDto,
  type CreatedApiKeyDto,
} from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const r = routes.apiKeys;

/** Personal access tokens of the signed-in account (browser session only). */
@Controller()
export class ApiKeysController {
  constructor(@Inject(ApiKeys) private readonly keys: ApiKeys) {}

  @Get(nestPath(r.list.path))
  list(@CurrentActor() actor: Actor | null): Promise<ApiKeyDto[]> {
    return this.keys.listOwn(actor);
  }

  @Post(nestPath(r.create.path))
  create(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(CreateApiKeyRequest)) body: CreateApiKeyRequest,
  ): Promise<CreatedApiKeyDto> {
    return this.keys.createPersonal(actor, body);
  }

  @Patch(nestPath(r.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('keyId') keyId: string,
    @Body(new ZodPipe(UpdateApiKeyRequest)) body: UpdateApiKeyRequest,
  ): Promise<ApiKeyDto> {
    return this.keys.updateOwn(actor, keyId, body);
  }

  @Post(nestPath(r.rotate.path))
  @HttpCode(200)
  rotate(@CurrentActor() actor: Actor | null, @Param('keyId') keyId: string): Promise<CreatedApiKeyDto> {
    return this.keys.rotateOwn(actor, keyId);
  }

  @Delete(nestPath(r.revoke.path))
  @HttpCode(204)
  async revoke(@CurrentActor() actor: Actor | null, @Param('keyId') keyId: string): Promise<void> {
    await this.keys.revokeOwn(actor, keyId);
  }
}

/** Every key of the instance and service keys (instance admins, browser session only). */
@Controller()
export class AdminApiKeysController {
  constructor(@Inject(ApiKeys) private readonly keys: ApiKeys) {}

  @Get(nestPath(r.adminList.path))
  list(@CurrentActor() actor: Actor | null): Promise<ApiKeyDto[]> {
    return this.keys.listAll(actor);
  }

  @Delete(nestPath(r.adminRevoke.path))
  @HttpCode(204)
  async revoke(@CurrentActor() actor: Actor | null, @Param('keyId') keyId: string): Promise<void> {
    await this.keys.revokeAny(actor, keyId);
  }

  @Post(nestPath(r.createService.path))
  createService(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(CreateServiceKeyRequest)) body: CreateServiceKeyRequest,
  ): Promise<CreatedApiKeyDto> {
    return this.keys.createService(actor, body);
  }

  @Patch(nestPath(r.updateService.path))
  updateService(
    @CurrentActor() actor: Actor | null,
    @Param('keyId') keyId: string,
    @Body(new ZodPipe(UpdateApiKeyRequest)) body: UpdateApiKeyRequest,
  ): Promise<ApiKeyDto> {
    return this.keys.updateService(actor, keyId, body);
  }

  @Post(nestPath(r.rotateService.path))
  @HttpCode(200)
  rotateService(
    @CurrentActor() actor: Actor | null,
    @Param('keyId') keyId: string,
  ): Promise<CreatedApiKeyDto> {
    return this.keys.rotateService(actor, keyId);
  }
}
