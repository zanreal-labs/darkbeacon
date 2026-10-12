import type { Actor } from '@darkbeacon/core';
import type {
  AuditScope,
  ChainLayoutRepository,
  ChainSources,
  ChainViewRepository,
  Clock,
  CompositeMaps,
  EventLog,
  MapAccess,
  ShareRepository,
  UnitOfWork,
} from '../ports/index.js';

/** Everything the sharing use cases need, wired by the composition root. */
export interface SharingPorts {
  shares: ShareRepository;
  sources: ChainSources;
  views: ChainViewRepository;
  layout: ChainLayoutRepository;
  composites: CompositeMaps;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
  audit: AuditScope;
}

/** Who writes the merged maps' own events (derived from their sources). */
export const SHARING_ACTOR: Actor = { kind: 'system', id: 'sharing' };
