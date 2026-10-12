import type {
  CommentDto,
  ConnectionDto,
  MapDto,
  MapPreferencesDto,
  MapSystemDto,
  PassageDto,
  SignatureDto,
  StructureDto,
} from '@darkbeacon/shared';

// For the MVP the entities have the same shape as their DTOs; split them when they diverge.
export type ChainMap = MapDto;
export type MapSystem = MapSystemDto;
export type Connection = ConnectionDto;
export type Signature = SignatureDto;
export type Passage = PassageDto;
export type Comment = CommentDto;
export type Structure = StructureDto;

/** One account's own view of a map; not an event, nobody else sees it. */
export interface MapPreferences extends MapPreferencesDto {
  mapId: string;
  accountId: string;
}
