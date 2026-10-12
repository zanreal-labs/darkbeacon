import { MERGE_ACTOR_ID, MERGE_COPY_ACTOR_ID } from '@darkbeacon/shared';
import type { Actor } from '@darkbeacon/core';
import type {
  AuditScope,
  ChainLayoutRepository,
  ChainSources,
  ChainViewRepository,
  Clock,
  CompositeMaps,
  EventLog,
  LocalFieldsRepository,
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
  /** A composite's own notes, labels and locks of systems. */
  local: LocalFieldsRepository;
  composites: CompositeMaps;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
  audit: AuditScope;
}

/** Who writes the merged maps' own events (derived from their sources). */
export const SHARING_ACTOR: Actor = { kind: 'system', id: MERGE_ACTOR_ID };

/** Who writes them on a map with objects of its own (copies webhooks and plugins skip). */
export const SHARING_COPY_ACTOR: Actor = { kind: 'system', id: MERGE_COPY_ACTOR_ID };
