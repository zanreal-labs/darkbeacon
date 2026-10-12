import type { CharacterPresence, TrackedCharacter } from '../domain/presence.js';

export interface TrackingRepository {
  listTracked(): Promise<TrackedCharacter[]>;
  listTrackedOnMap(mapId: string): Promise<TrackedCharacter[]>;
  findTracked(mapId: string, characterId: number): Promise<TrackedCharacter | null>;
  setTracked(entry: TrackedCharacter, tracked: boolean): Promise<void>;
  /** Stops tracking anything on the map (the map is gone). */
  untrackMap(mapId: string): Promise<void>;
  getPresence(characterId: number): Promise<CharacterPresence | null>;
  listPresence(characterIds: readonly number[]): Promise<CharacterPresence[]>;
  savePresence(presence: CharacterPresence): Promise<void>;
  deletePresence(characterId: number): Promise<void>;
}
