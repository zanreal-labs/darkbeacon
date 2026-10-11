import type { DynamicModule, Type } from '@nestjs/common';

/**
 * Feature modules of the composition root. Each module replaces its own placeholder with ONE line:
 *
 *   (await import('./mapping/mapping.module.js')).MappingModule,
 *
 * Keep the blank lines between entries so parallel changes merge cleanly.
 */
export const featureModules: Array<Type | DynamicModule> = [
  (await import('./identity/identity.module.js')).IdentityModule,
  (await import('./access/access.module.js')).AccessModule,
  // mapping
  // tracking
  // notifications
  // plugins
];
