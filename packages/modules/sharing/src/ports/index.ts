import type { Actor } from '@darkbeacon/core';
import type { McpMode } from '@darkbeacon/shared';
import type { MapShare } from '../domain/share.js';

export type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

export interface MapShareRepository {
  find(mapId: string): Promise<MapShare | null>;
  findByToken(token: string): Promise<MapShare | null>;
  findBySlug(slug: string): Promise<MapShare | null>;
  /** Every map whose public link is on. */
  listEnabled(): Promise<MapShare[]>;
  save(share: MapShare): Promise<void>;
  delete(mapId: string): Promise<void>;
}

/** Instance settings that bound sharing (from access's instance settings). */
export interface SharingPolicy {
  publicMaps(): Promise<boolean>;
  mcpMode(): Promise<McpMode>;
}

/** Random link tokens (node:crypto in the server). */
export interface ShareSecrets {
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
