import { z } from 'zod';
import { EveId, Id } from './common.js';

/** A point in map coordinates (the canvas' flow coordinates, not screen pixels). */
export const MapPoint = z.object({ x: z.number().finite(), y: z.number().finite() });
export type MapPoint = z.infer<typeof MapPoint>;

/** Systems being dragged, where they would land. */
export const PresenceDrag = z.object({
  systems: z
    .array(z.object({ solarSystemId: EveId, x: z.number().finite(), y: z.number().finite() }))
    .max(50),
});
export type PresenceDrag = z.infer<typeof PresenceDrag>;

/** What someone has open for editing: a system, connection, signature or the map, maybe one field. */
export const PresenceEditing = z.object({
  kind: z.enum(['system', 'connection', 'signature', 'map']),
  /** Solar system id, connection id, signature id or map id, as a string. */
  id: z.string().min(1).max(64),
  field: z.string().min(1).max(40).optional(),
});
export type PresenceEditing = z.infer<typeof PresenceEditing>;

/**
 * What someone is changing right now. Their cursor reaches the others only while there is one
 * (the client keeps it a short grace after the action ends), with a verb and an outline on the
 * target.
 */
export const PresenceActivity = z.object({
  verb: z.enum(['moving', 'linking', 'editing', 'pasting']),
  /** The system or connection being changed (a signature: its system); outlined for the others. */
  target: z
    .object({ kind: z.enum(['system', 'connection']), id: z.string().min(1).max(64) })
    .nullable()
    .optional(),
  /** Words after the verb, e.g. the system's name in "editing J014348". */
  label: z.string().min(1).max(40).optional(),
});
export type PresenceActivity = z.infer<typeof PresenceActivity>;

/** Deprecated: no longer shared (a selection says nothing about what someone does). */
export const PresenceSelection = z.object({
  systems: z.array(EveId).max(200),
  connections: z.array(Id).max(200),
});
export type PresenceSelection = z.infer<typeof PresenceSelection>;

/**
 * What a client shares about itself on a map. The cursor and drag preview reach the others only
 * while `activity` is set: idle positions are never relayed, and clients from before `activity`
 * (which never send one) show no cursor.
 */
export const PresenceState = z.object({
  cursor: MapPoint.nullable(),
  drag: PresenceDrag.nullable(),
  editing: PresenceEditing.nullable(),
  /** Deprecated: accepted and ignored; always null for the others. */
  selection: PresenceSelection.nullable(),
  activity: PresenceActivity.nullable(),
});
export type PresenceState = z.infer<typeof PresenceState>;
/** An update: fields left out keep their value, null clears one. */
export const PresenceStatePatch = PresenceState.partial();
export type PresenceStatePatch = z.infer<typeof PresenceStatePatch>;

/** Someone on a map (one per open tab). Never stored. */
export const PresencePeerDto = PresenceState.extend({
  /** This tab's key on this map; stable while the tab stays connected. */
  key: z.string(),
  accountId: Id,
  name: z.string(),
  characterId: EveId.nullable(),
  characterName: z.string().nullable(),
  /** Index into the presence colour tokens (`--dbk-presence-0` ... `-7`), stable per account. */
  color: z.number().int().min(0).max(7),
  /** When this tab arrived on the map (epoch ms). */
  since: z.number().int(),
});
export type PresencePeerDto = z.infer<typeof PresencePeerDto>;

/**
 * A change to someone already on the map: the key and only the fields that changed. A peer that
 * just arrived (or changed its presence settings) comes in full, as a PresencePeerDto.
 */
export const PresencePeerPatch = PresencePeerDto.partial().required({ key: true });
export type PresencePeerPatch = z.infer<typeof PresencePeerPatch>;

/** Per-account presence choices, kept on the server so they follow the person. */
export const PresenceSettingsDto = z.object({
  /** Others see my cursor and drag previews (only while I am changing something). */
  shareCursor: z.boolean(),
  /** I see others' cursors and drag previews (who is here and editing markers stay). */
  showOthers: z.boolean(),
});
export type PresenceSettingsDto = z.infer<typeof PresenceSettingsDto>;

export const UpdatePresenceSettingsRequest = PresenceSettingsDto.partial();
export type UpdatePresenceSettingsRequest = z.infer<typeof UpdatePresenceSettingsRequest>;

export const PRESENCE_COLORS = 8;
/** Peak rate of presence messages per map, in both directions. */
export const PRESENCE_HZ = 15;
/**
 * Peer updates one viewer receives per second at most: a map with more than about 40 people
 * moving is flushed less often than PRESENCE_HZ (150 people: 4 times a second).
 */
export const PRESENCE_PEER_BUDGET = 600;
