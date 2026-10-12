import { Module } from '@nestjs/common';
import { MappingModule } from '../mapping/mapping.module.js';
import { SharingModule } from '../sharing/sharing.module.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

/** `DEMO_MODE=true`: automatic sign-in as a demo account and a seeded demo map. */
@Module({
  imports: [MappingModule, SharingModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
