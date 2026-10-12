import { parseStream, type DomainEvent } from '@darkbeacon/core';
import { isEventOfType, isMergeEvent, LOCAL_INSTANCE } from '@darkbeacon/shared';
import { feedSignal } from '../domain/feed.js';
import type { ChainMerger } from './merger.js';
import type { SharingPorts } from './ports.js';

/**
 * Follows the events of local maps for the maps that merge them: objects that changed are read
 * again, renamed maps rename their sources, deleted maps take their shares with them. The merged
 * maps' own events (written by sharing) are skipped, so merges never feed themselves.
 */
export class SharingFeed {
  constructor(
    private readonly ports: Pick<SharingPorts, 'shares'>,
    private readonly merger: ChainMerger,
  ) {}

  async handle(event: DomainEvent): Promise<void> {
    const stream = parseStream(event.stream);
    if (stream?.kind !== 'map') return;
    if (isMergeEvent(event)) return;
    const mapId = stream.id;
    const origin = { instance: LOCAL_INSTANCE, mapId };
    if (isEventOfType(event, 'map.created')) {
      if (event.data.kind === 'composite') await this.merger.rebuild(mapId);
      return;
    }
    const signal = feedSignal(event);
    if (!signal) return;
    if (signal.kind === 'objects') await this.merger.sourceChanged(origin, signal.selectors);
    else if (signal.kind === 'renamed') await this.merger.mapChanged(mapId);
    else {
      // The map is gone: its shares go, and its objects from every map that merged it.
      const gone = await this.ports.shares.deleteForMap(origin);
      const targets = gone.filter((s) => s.target.instance === LOCAL_INSTANCE).map((s) => s.target.mapId);
      await Promise.all([...new Set([mapId, ...targets])].map((id) => this.merger.rebuild(id)));
    }
  }
}
