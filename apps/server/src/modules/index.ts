import type { DynamicModule, Type } from '@nestjs/common';

/** Feature modules of the composition root, one line each. */
export const featureModules: Array<Type | DynamicModule> = [
  (await import('./identity/identity.module.js')).IdentityModule,
  (await import('./access/access.module.js')).AccessModule,
  (await import('./mapping/mapping.module.js')).MappingModule,
  (await import('./universe/universe.module.js')).UniverseModule,
  (await import('./tracking/tracking.module.js')).TrackingModule,
  (await import('./routing/routing.module.js')).RoutingModule,
  (await import('./notifications/notifications.module.js')).NotificationsModule,
  (await import('./plugins/plugins.module.js')).PluginsModule,
  (await import('./audit/audit.module.js')).AuditModule,
  (await import('./demo/demo.module.js')).DemoModule,
];
