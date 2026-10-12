import { Module } from '@nestjs/common';
import { MappingModule } from '../mapping/mapping.module.js';
import { WandererCompatController } from './wanderer-compat.controller.js';

/**
 * Wanderer's legacy public map API and SSE stream over Darkbeacon's own use cases (a driving
 * adapter, nothing of its own is stored). See `routes.wandererCompat` and docs/api.md.
 */
@Module({ imports: [MappingModule], controllers: [WandererCompatController] })
export class WandererCompatModule {}
