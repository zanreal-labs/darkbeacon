import { z } from 'zod';

/*
 * Wanderer's legacy public map API shapes (v1.103, from its code), for the compatible routes in
 * `routes.wandererCompat`. Integers and snake_case are Wanderer's; nothing else uses these.
 */

const Iso = z.string().describe('ISO 8601 UTC with microseconds');

export const WandererSystemDto = z.object({
  id: z.string(),
  map_id: z.string(),
  solar_system_id: z.number().int(),
  name: z.string(),
  original_name: z.string(),
  custom_name: z.string().nullable(),
  temporary_name: z.string().nullable(),
  description: z.string().nullable(),
  tag: z.string().nullable(),
  /** JSON of `{customLabel, labels}` as Wanderer's map writes it, or null. */
  labels: z.string().nullable(),
  locked: z.boolean(),
  visible: z.boolean(),
  /** 0 clear, 1 home, 2 friendly, 3 looking for, 4 warning, 5 target, 6 dangerous. */
  status: z.number().int(),
  position_x: z.number().int(),
  position_y: z.number().int(),
  inserted_at: Iso,
  updated_at: Iso,
});

export const WandererConnectionDto = z.object({
  id: z.string(),
  map_id: z.string(),
  solar_system_source: z.number().int(),
  solar_system_target: z.number().int(),
  /** 0 normal, 1 half, 2 critical. */
  mass_status: z.number().int(),
  /** 0 normal, 1 end of life. */
  time_status: z.number().int(),
  /** 0 small, 1 medium, 2 large, 3 freighter, 4 capital. */
  ship_size_type: z.number().int(),
  /** 0 wormhole, 1 stargate, 2 bridge. */
  type: z.number().int(),
  wormhole_type: z.string().nullable(),
  locked: z.boolean(),
  inserted_at: Iso,
  updated_at: Iso,
});

export const WandererCharacterDto = z.object({
  eve_id: z.string(),
  name: z.string(),
  corporation_id: z.number().int().nullable(),
  corporation_ticker: z.string().nullable(),
  alliance_id: z.number().int().nullable(),
  alliance_ticker: z.string().nullable(),
});

export const WandererSystemsDto = z.object({
  data: z.object({ systems: z.array(WandererSystemDto), connections: z.array(WandererConnectionDto) }),
});
export const WandererSystemResponseDto = z.object({ data: WandererSystemDto });
export const WandererConnectionsDto = z.object({ data: z.array(WandererConnectionDto) });
export const WandererTrackedCharactersDto = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      map_id: z.string(),
      character_id: z.string(),
      tracked: z.boolean(),
      followed: z.boolean(),
      inserted_at: Iso,
      updated_at: Iso,
      character: WandererCharacterDto,
    }),
  ),
});
export const WandererUserCharactersDto = z.object({
  data: z.array(
    z.object({ characters: z.array(WandererCharacterDto), main_character_eve_id: z.string().nullable() }),
  ),
});
