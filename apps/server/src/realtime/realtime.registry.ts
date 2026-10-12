import { Injectable } from '@nestjs/common';
import { INSTANCE_STREAM, type Actor, type DomainEvent } from '@darkbeacon/core';

/**
 * A stream that shows another stream through a filter (public maps: `public:<token>` shows
 * `map:<id>` cut down to what the link shares). Its seq is the source stream's seq; events the
 * filter drops still advance it, so subscribers resume without gaps.
 */
export interface StreamView {
  /** The stream the events come from (`map:<id>`), or null when the id does not resolve. */
  source(id: string): Promise<string | null>;
  /** The event as subscribers of `stream` receive it, or null when they do not. */
  project(id: string, event: DomainEvent, stream: string): Promise<DomainEvent | null>;
}

export interface StreamKind {
  /** May `actor` subscribe to `<kind>:<id>`? Called on subscribe and again after `access.*` events. */
  authorize(actor: Actor | null, id: string): boolean | Promise<boolean>;
  /** Only on subscribe (not on re-checks): e.g. a rate limit per client address. */
  admit?(id: string, client: { ip: string | null }): boolean;
  view?: StreamView;
}

/**
 * Contributes part of a snapshot; the parts of a stream kind are merged with Object.assign.
 * Runs inside a read transaction, so repositories see one consistent state.
 */
export type SnapshotProvider = (id: string, actor: Actor | null) => Promise<Record<string, unknown>>;

/**
 * Extension point of the realtime gateway. Modules register in `onModuleInit`:
 *
 *   registry.registerStream('map', { authorize: (actor, mapId) => ... });   // access module
 *   registry.registerSnapshot('map', async (mapId) => ({ systems, connections })); // mapping
 */
@Injectable()
export class RealtimeRegistry {
  private readonly kinds = new Map<string, StreamKind>();
  private readonly snapshots = new Map<string, SnapshotProvider[]>();

  constructor() {
    // Default: any signed-in account may follow the instance stream. Replaceable.
    this.registerStream(INSTANCE_STREAM, { authorize: (actor) => actor?.kind === 'account' });
  }

  /** Registers (or replaces) the authorizer of a stream kind such as `map`. */
  registerStream(kind: string, definition: StreamKind): void {
    this.kinds.set(kind, definition);
  }

  registerSnapshot(kind: string, provider: SnapshotProvider): void {
    this.snapshots.set(kind, [...(this.snapshots.get(kind) ?? []), provider]);
  }

  stream(kind: string): StreamKind | undefined {
    return this.kinds.get(kind);
  }

  snapshotProviders(kind: string): readonly SnapshotProvider[] {
    return this.snapshots.get(kind) ?? [];
  }
}
