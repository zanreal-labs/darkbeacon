import { mapStream } from '@darkbeacon/core';
import type { MapViewers } from '@darkbeacon/tracking';

/** Tracking's MapViewers over the realtime hub: a map is viewed while a socket follows its stream. */
export class RealtimeMapViewers implements MapViewers {
  constructor(private readonly hub: { followers(stream: string): number }) {}

  isViewed(mapId: string): boolean {
    return this.hub.followers(mapStream(mapId)) > 0;
  }
}
