import type { ConnectionDto, MapDto, MapSystemDto, SignatureDto } from '@darkbeacon/shared';

// For the MVP the entities have the same shape as their DTOs; split them when they diverge.
export type ChainMap = MapDto;
export type MapSystem = MapSystemDto;
export type Connection = ConnectionDto;
export type Signature = SignatureDto;
