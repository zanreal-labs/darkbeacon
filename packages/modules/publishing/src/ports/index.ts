import type { Actor } from '@darkbeacon/core';
import type { McpMode } from '@darkbeacon/shared';
import type { PublicLink } from '../domain/link.js';

export type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

export interface PublicLinkRepository {
  find(mapId: string): Promise<PublicLink | null>;
  findByToken(token: string): Promise<PublicLink | null>;
  findBySlug(slug: string): Promise<PublicLink | null>;
  /** Every map whose public link is on. */
  listEnabled(): Promise<PublicLink[]>;
  save(share: PublicLink): Promise<void>;
  delete(mapId: string): Promise<void>;
}

/** Instance settings that bound sharing (from access's instance settings). */
export interface PublishingPolicy {
  publicMaps(): Promise<boolean>;
  mcpMode(): Promise<McpMode>;
}

/** Random link tokens (node:crypto in the server). */
export interface LinkSecrets {
  random(length: number): string;
}

/**
 * Reads a map the way a realtime subscriber would (the merged `map:<id>` snapshot with its head
 * seq), as the given actor, so the same authorization applies. Composed in the server from the
 * realtime hub.
 */
export interface MapSnapshotReader {
  read(actor: Actor, mapId: string): Promise<{ seq: number; data: Record<string, unknown> }>;
}
