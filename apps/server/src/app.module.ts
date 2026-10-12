import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/config.js';
import { HealthController } from './health/health.controller.js';
import { featureModules } from './modules/index.js';
import { PlatformModule, type PlatformOptions } from './platform/platform.module.js';
import { WEB_UPSTREAM } from './platform/tokens.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { WebLifecycle } from './web/web-lifecycle.js';
import type { WebUpstream } from './web/web-proxy.js';

@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    options: PlatformOptions = {},
    web: (WebUpstream & { stop?(): Promise<void> }) | null = null,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config, options), RealtimeModule, ...featureModules],
      controllers: [HealthController],
      providers: [
        { provide: WEB_UPSTREAM, useValue: web },
        { provide: WebLifecycle, useFactory: () => new WebLifecycle(web) },
      ],
    };
  }
}
