/**
 * DI tokens for ports (interfaces cannot be tokens). Inject with `@Inject(EVENT_LOG)`.
 * `Database` (from @darkbeacon/db) is its own token and is also the UnitOfWork.
 */
export const APP_CONFIG = 'AppConfig';
export const CLOCK = 'Clock';
export const EVENT_LOG = 'EventLog';
export const EVENT_BUS = 'EventBus';
/** Leadership: whether this process runs the once-per-instance work (see platform/cluster.ts). */
export const LEADERSHIP = 'Leadership';
/** Signals: small ephemeral messages to every process of the instance (see platform/cluster.ts). */
export const SIGNALS = 'Signals';
export const UNIT_OF_WORK = 'UnitOfWork';
/** MapAccess port, provided by the access module. */
export const MAP_ACCESS = 'MapAccess';
/** `typeof fetch` used by outgoing HTTP adapters, replaceable in tests. */
export const HTTP_FETCH = 'HttpFetch';
/** UniverseCatalog (static game data), provided globally by the universe module. */
export const UNIVERSE_CATALOG = 'UniverseCatalog';
/** CharacterTokenSource for tracking, composed from identity (`IdentityCharacterTokens`). */
export const CHARACTER_TOKENS = 'CharacterTokenSource';
/** AutoMapTarget for tracking's auto-mapping, composed from mapping. */
export const AUTO_MAP_TARGET = 'AutoMapTarget';
/** The web app's server behind the API (`WebUpstream | null`), for health checks. */
export const WEB_UPSTREAM = 'WebUpstream';
/** AuditScope: facts about the current change (channel, origin, character, revert) for the audit trail. */
export const AUDIT_SCOPE = 'AuditScope';
/**
 * DomainTelemetry (`@darkbeacon/observability`), or null while telemetry is off. Provided by the
 * observability module; always inject it as optional, so that module can be left out.
 */
export const OBSERVABILITY = 'Observability';
