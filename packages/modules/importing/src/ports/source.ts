import type { ImportSourceKind } from '@darkbeacon/shared';
import type { WandererBase } from '../domain/source-url.js';
import type { WandererMapDump } from '../domain/wanderer.js';

/** How to reach a Wanderer instance's API for one map. */
export interface WandererApiRequest {
  kind: 'wanderer-api';
  base: WandererBase;
  slug: string;
  apiKey: string;
  aclKeys: ReadonlyArray<{ aclId: string; key: string }>;
  /** Accept a self-signed certificate. */
  insecureTls: boolean;
  /** Whether the instance may be on a private or local network (an instance setting). */
  allowPrivate: boolean;
}

/** An uploaded export file, already parsed as JSON (size-limited at the edge). */
export interface WandererFileRequest {
  kind: 'wanderer-file';
  document: unknown;
  fileName: string | null;
}

/**
 * A Wanderer's own Postgres database, read with SELECTs in a read-only transaction (instance
 * admins only: the server connects wherever the connection string says).
 */
export interface WandererDbRequest {
  kind: 'wanderer-db';
  /** `postgres://user:password@host:5432/database`. */
  connectionString: string;
  /** The map's slug. */
  slug: string;
  /**
   * Where imports from it are filed (`host/slug`): the Wanderer's own address when given, so the
   * database and the API of one Wanderer count as the same source; else the database's host.
   */
  host: string;
}

export type SourceRequest = WandererApiRequest | WandererFileRequest | WandererDbRequest;

/** A map of a Wanderer database, for choosing which one to import. */
export interface WandererDbMap {
  slug: string;
  name: string | null;
  systems: number;
  hiddenSystems: number;
}

/**
 * Where a map is imported from. Adapters: Wanderer's API (HTTP, paginated, rate limited),
 * Wanderer's export file and Wanderer's database. Failures to read throw `SourceError`; parts
 * that fail without stopping the import (an endpoint the instance does not have) go into
 * `dump.warnings`.
 */
export interface MapImportSource {
  readonly kind: ImportSourceKind;
  /**
   * A quick check that the source answers and the credentials work: the systems shown on the map
   * and the hidden ones (null when the source does not list them).
   */
  test(
    request: SourceRequest,
  ): Promise<{ systems: number; hiddenSystems: number | null; name: string | null }>;
  /** Reads the whole map. `onStep` is told what is being read (for progress). */
  read(request: SourceRequest, onStep?: (step: string) => void): Promise<WandererMapDump>;
}

/** Wanderer's database as a source: it also lists the maps it holds. */
export interface WandererDbSource extends MapImportSource {
  maps(connectionString: string): Promise<WandererDbMap[]>;
}
