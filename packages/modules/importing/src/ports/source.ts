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

export type SourceRequest = WandererApiRequest | WandererFileRequest;

/**
 * Where a map is imported from. Adapters: Wanderer's API (HTTP, paginated, rate limited) and
 * Wanderer's export file. Failures to read throw `SourceError`; parts that fail without stopping
 * the import (an endpoint the instance does not have) go into `dump.warnings`.
 */
export interface MapImportSource {
  readonly kind: ImportSourceKind;
  /** A quick check that the source answers and the credentials work. */
  test(request: SourceRequest): Promise<{ systems: number; name: string | null }>;
  /** Reads the whole map. `onStep` is told what is being read (for progress). */
  read(request: SourceRequest, onStep?: (step: string) => void): Promise<WandererMapDump>;
}
