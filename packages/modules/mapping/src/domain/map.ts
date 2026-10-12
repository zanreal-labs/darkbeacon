import type {
  CommentDto,
  ConnectionDto,
  MapDto,
  MapPreferencesDto,
  MapSystemDto,
  MassMode,
  PassageSource,
  SignatureDto,
  StructureDto,
} from '@darkbeacon/shared';

// For the MVP the entities have the same shape as their DTOs; split them when they diverge.
export type ChainMap = MapDto;
export type MapSystem = MapSystemDto;
export type Connection = ConnectionDto;
export type Signature = SignatureDto;

/** A ship that went through a connection: a tracked character's jump or one logged by hand. */
export interface Passage {
  id: string;
  connectionId: string;
  /** Null for passages logged by hand. */
  characterId: number | null;
  shipTypeId: number | null;
  /** Mass the jump put on the hole (kg); null when the ship is unknown. */
  mass: number | null;
  from: number;
  to: number;
  occurredAt: number;
  source: PassageSource;
  massMode: MassMode;
  higgs: boolean;
  entangler: boolean;
  note: string | null;
  /** The account that logged it by hand; null for tracked jumps. */
  createdBy: string | null;
}
export type Comment = CommentDto;
export type Structure = StructureDto;

/** One account's own view of a map; not an event, nobody else sees it. */
export interface MapPreferences extends MapPreferencesDto {
  mapId: string;
  accountId: string;
}
