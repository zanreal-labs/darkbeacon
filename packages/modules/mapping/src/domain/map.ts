import type {
  ConnectionDto,
  MapDto,
  MapPreferencesDto,
  MapSystemDto,
  PassageDto,
  SignatureDto,
} from '@darkbeacon/shared';

// For the MVP the entities have the same shape as their DTOs; split them when they diverge.
export type ChainMap = MapDto;
export type MapSystem = MapSystemDto;
export type Connection = ConnectionDto;
export type Signature = SignatureDto;
export type Passage = PassageDto;

/** One account's own view of a map; not an event, nobody else sees it. */
export interface MapPreferences extends MapPreferencesDto {
  mapId: string;
  accountId: string;
}
