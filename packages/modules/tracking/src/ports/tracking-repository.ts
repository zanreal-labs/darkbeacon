import type { CharacterPresence, TrackedCharacter } from '../domain/presence.js';

export interface TrackingRepository {
  listTracked(): Promise<TrackedCharacter[]>;
  listTrackedOnMap(mapId: string): Promise<TrackedCharacter[]>;
  setTracked(entry: TrackedCharacter, tracked: boolean): Promise<void>;
  getPresence(characterId: number): Promise<CharacterPresence | null>;
  savePresence(presence: CharacterPresence): Promise<void>;
}
