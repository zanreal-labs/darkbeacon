/**
 * DI tokens for ports (interfaces cannot be tokens). Inject with `@Inject(EVENT_LOG)`.
 * `Database` (from @wormwright/db) is its own token and is also the UnitOfWork.
 */
export const APP_CONFIG = 'AppConfig';
export const CLOCK = 'Clock';
export const EVENT_LOG = 'EventLog';
export const EVENT_BUS = 'EventBus';
export const UNIT_OF_WORK = 'UnitOfWork';
/** MapAccess port, provided by the access module. */
export const MAP_ACCESS = 'MapAccess';
/** UniverseCatalog (static game data), provided globally by the universe module. */
export const UNIVERSE_CATALOG = 'UniverseCatalog';
