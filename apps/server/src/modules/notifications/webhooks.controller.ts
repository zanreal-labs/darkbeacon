import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { Actor } from '@wormwright/core';
import { WebhookAdmin } from '@wormwright/notifications';
import {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  nestPath,
  routes,
  type CreatedWebhookDto,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@wormwright/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const r = routes.webhooks;

@Controller()
export class WebhooksController {
  constructor(@Inject(WebhookAdmin) private readonly webhooks: WebhookAdmin) {}

  @Get(nestPath(r.list.path))
  list(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<WebhookDto[]> {
    return this.webhooks.list(actor, mapId);
  }

  @Post(nestPath(r.create.path))
  create(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(CreateWebhookRequest)) body: CreateWebhookRequest,
  ): Promise<CreatedWebhookDto> {
    return this.webhooks.create(actor, mapId, body);
  }

  @Patch(nestPath(r.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('webhookId') webhookId: string,
    @Body(new ZodPipe(UpdateWebhookRequest)) body: UpdateWebhookRequest,
  ): Promise<WebhookDto> {
    return this.webhooks.update(actor, mapId, webhookId, body);
  }

  @Delete(nestPath(r.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<void> {
    await this.webhooks.remove(actor, mapId, webhookId);
  }

  @Get(nestPath(r.deliveries.path))
  deliveries(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<WebhookDeliveryDto[]> {
    return this.webhooks.deliveries(actor, mapId, webhookId);
  }

  @Post(nestPath(r.test.path))
  @HttpCode(200)
  test(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<WebhookDeliveryDto> {
    return this.webhooks.test(actor, mapId, webhookId);
  }
}
