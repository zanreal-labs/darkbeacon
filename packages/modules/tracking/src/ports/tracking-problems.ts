import type { TrackingProblemDto } from '@darkbeacon/shared';

/** Why tracking cannot read a character's location now (see `TrackingProblemDto`). */
export interface TrackingProblem extends TrackingProblemDto {
  characterId: number;
}

/**
 * Where the poller keeps the problems it ran into, so the character's owner sees them from any
 * replica. Written only when a character's problem starts, changes or ends.
 */
export interface TrackingProblemStore {
  set(problem: TrackingProblem): Promise<void>;
  clear(characterId: number): Promise<void>;
  list(characterIds: readonly number[]): Promise<TrackingProblem[]>;
}
