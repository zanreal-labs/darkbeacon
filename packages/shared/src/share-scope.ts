import { z } from 'zod';

/**
 * What map data a share lets the other side see. One vocabulary for every way map data leaves its
 * map: shares between maps of an instance, public maps and, later, other instances.
 *
 * - `topology`: systems and the connections between them (always part of a share).
 * - `connectionStatus`: mass, time (EOL), size, bubbles and danger of connections.
 * - `signatures`: the signatures scanned in each system.
 * - `intel`: what a map knows about its systems: status, tag, custom name, notes.
 * - `characters`: where the map's tracked characters are, their ships, whether they are online.
 * - `labels`: bookmark labels of systems.
 */
export const shareScope = z.enum([
  'topology',
  'connectionStatus',
  'signatures',
  'intel',
  'characters',
  'labels',
]);
export type ShareScope = z.infer<typeof shareScope>;

/**
 * The scope that map entities outside the chain format belong to: they leave their map only
 * under it. Comments and structures are what a map knows about its systems, like its notes.
 */
export const ENTITY_SHARE_SCOPES = {
  comment: 'intel',
  structure: 'intel',
} as const satisfies Record<string, ShareScope>;

/** Scopes that tell the other side about a map's own people and plans; the UI marks them. */
export const SENSITIVE_SHARE_SCOPES: readonly ShareScope[] = ['intel', 'characters'];
