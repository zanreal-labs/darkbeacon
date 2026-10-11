import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/config.js';
import { HealthController } from './health/health.controller.js';
import { featureModules } from './modules/index.js';
import { PlatformModule, type PlatformOptions } from './platform/platform.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: PlatformOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config, options), RealtimeModule, ...featureModules],
      controllers: [HealthController],
    };
  }
}
