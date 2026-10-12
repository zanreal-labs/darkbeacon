import { z } from 'zod';

/**
 * What a shared view of a map may show (public maps, shared chains, anonymous MCP):
 *
 * - `topology`: systems, their places and the connections between them (always part of a share)
 * - `connectionStatus`: mass, time (EOL) and ship size of connections
 * - `signatures`: signatures and what they are
 * - `intel`: system notes, status, tags, custom names, structures and kill information (sensitive)
 * - `characters`: tracked characters, their names and positions (sensitive)
 * - `labels`: the map's labels on systems
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

/** Scopes that reveal who is where or what a group knows; never on by default. */
export const SENSITIVE_SHARE_SCOPES: readonly ShareScope[] = ['intel', 'characters'];
