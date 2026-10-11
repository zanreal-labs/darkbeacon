import type { TrackingRepository } from '../ports/index.js';

/** Reactions to other modules' events that end tracking. */
export class TrackingCleanup {
  constructor(private readonly deps: { tracking: TrackingRepository }) {}

  /** The map was deleted (`map.removed`): nothing is tracked on it any more. */
  forgetMap(mapId: string): Promise<void> {
    return this.deps.tracking.untrackMap(mapId);
  }
}
