import { z } from 'zod';
import { MapRole } from './access.js';
import { Id, EveId } from './common.js';
import {
  Bubbled,
  ConnectionType,
  MassStatus,
  Position,
  ShipSize,
  SystemStatus,
  TimeStatus,
  CONNECTION_NOTE_MAX,
  CUSTOM_LABEL_MAX,
} from './mapping.js';

/*
 * Systems copied from one map and pasted on another (Wanderer's copy/paste, keeping what the fork
 * keeps): the systems with their attributes and the connections between them with their flags.
 * Labels and Tags travel by name, since every map has its own; a paste uses the target map's
 * Labels and Tags of the same name and leaves out the rest.
 */

/** The `kind` of a clipboard text that holds Darkbeacon systems. */
export const SYSTEMS_CLIPBOARD_KIND = 'darkbeacon/systems';

export const ClipboardSystem = z.object({
  solarSystemId: EveId,
  position: Position,
  status: SystemStatus.default('unknown'),
  customName: z.string().trim().max(64).nullable().default(null),
  temporaryName: z.string().trim().max(64).nullable().default(null),
  tag: z.string().trim().max(16).nullable().default(null),
  description: z.string().max(10_000).default(''),
  customLabel: z.string().trim().max(CUSTOM_LABEL_MAX).nullable().default(null),
  /** Label (WH1...) names. */
  systemLabels: z.array(z.string().max(8)).max(32).default([]),
  /** Tag names. */
  tags: z.array(z.string().max(32)).max(16).default([]),
  locked: z.boolean().default(false),
});
export type ClipboardSystem = z.infer<typeof ClipboardSystem>;

export const ClipboardConnection = z.object({
  source: EveId,
  target: EveId,
  type: ConnectionType.default('wormhole'),
  timeStatus: TimeStatus.default('normal'),
  massStatus: MassStatus.default('fresh'),
  shipSize: ShipSize.default('large'),
  massSaved: z.boolean().default(false),
  dangerous: z.boolean().default(false),
  bubbled: Bubbled.default('none'),
  note: z.string().max(CONNECTION_NOTE_MAX).default(''),
});
export type ClipboardConnection = z.infer<typeof ClipboardConnection>;

/** What Ctrl+C on a selection puts on the clipboard (as JSON text). */
export const SystemsClipboard = z.object({
  kind: z.literal(SYSTEMS_CLIPBOARD_KIND),
  v: z.literal(1),
  /** The map it was copied from, for the "pasted from" note. */
  from: z.object({ mapId: Id, name: z.string().max(64) }),
  systems: z.array(ClipboardSystem).min(1).max(500),
  connections: z.array(ClipboardConnection).max(1000).default([]),
});
export type SystemsClipboard = z.infer<typeof SystemsClipboard>;
export type SystemsClipboardInput = z.input<typeof SystemsClipboard>;

/**
 * POST /api/maps/:mapId/paste: the clipboard's systems placed with their top left at `at` (map
 * coordinates). Systems already on the map stay as they are and are only connected.
 */
export const PasteSystemsRequest = z.object({ clipboard: SystemsClipboard, at: Position });
export type PasteSystemsRequest = z.infer<typeof PasteSystemsRequest>;

/** PUT /api/maps/:mapId/clipboard-roles: the lowest role that may copy, and that may paste. */
export const ClipboardRolesRequest = z.object({ copy: MapRole, paste: MapRole });
export type ClipboardRolesRequest = z.infer<typeof ClipboardRolesRequest>;

export const PasteSystemsResultDto = z.object({
  /** Systems put on the map (new or brought back). */
  added: z.array(EveId),
  /** Systems that were on the map already. */
  existing: z.array(EveId),
  connections: z.number().int().nonnegative(),
  /** Label and Tag names this map does not have. */
  missingLabels: z.array(z.string()),
});
export type PasteSystemsResultDto = z.infer<typeof PasteSystemsResultDto>;
