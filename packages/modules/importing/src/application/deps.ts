import type { AuditScope, Clock, EventLog, UnitOfWork } from '@darkbeacon/core';
import type {
  ImportJobRepository,
  ImportLinkRepository,
  ImportPolicy,
  ImportSyncRepository,
  SecretSealer,
} from '../ports/repositories.js';
import type { MapImportSource, WandererDbSource } from '../ports/source.js';
import type { AccessTarget, ChainTarget, EveNames, SystemNames, WebhookTarget } from '../ports/target.js';

/** Everything the import use cases need, wired by the composition root. */
export interface ImportingDeps {
  /** Wanderer's API, Wanderer's export files and Wanderer's database. */
  sources: { api: MapImportSource; file: MapImportSource; db: WandererDbSource };
  target: ChainTarget;
  access: AccessTarget;
  webhooks: WebhookTarget;
  names: EveNames;
  universe: SystemNames;
  jobs: ImportJobRepository;
  links: ImportLinkRepository;
  syncs: ImportSyncRepository;
  secrets: SecretSealer;
  policy: ImportPolicy;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
  audit: AuditScope;
  /** Asks the job runner to look for queued jobs (outside the caller's request). */
  wake(): void;
}
