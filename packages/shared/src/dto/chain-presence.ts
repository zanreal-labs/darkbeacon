import { z } from 'zod';
import { EveId, Timestamp } from './common.js';
import type { ConnectionDto, MapSystemDto } from './mapping.js';

/**
 * When a system was last part of the map's chain from home: reachable from a home system
 * through the map's connections. `leftAt` is null while it still is; then `joinedAt` is when it
 * joined this time. `previousLeftAt` is when it left the chain the time before it last joined
 * (null: that was its first time since the record began), so a system in the chain now can still
 * say when it was last there before.
 */
export const ChainPresenceDto = z.object({
  solarSystemId: EveId,
  joinedAt: Timestamp,
  leftAt: Timestamp.nullable(),
  previousLeftAt: Timestamp.nullable(),
});
export type ChainPresenceDto = z.infer<typeof ChainPresenceDto>;

/**
 * Every system the map's chain ever held, and since when the map keeps the record (the oldest
 * moment in it; null while it holds nothing): a system without a row was never in the chain since.
 */
export const ChainPresenceListDto = z.object({
  recordedSince: Timestamp.nullable(),
  systems: z.array(ChainPresenceDto),
});
export type ChainPresenceListDto = z.infer<typeof ChainPresenceListDto>;

/**
 * The systems of the chain from home: every visible system reachable from a visible system with
 * status `home` through the connections, whatever their kind. A map without a home grows from its
 * oldest visible system, as the bookmark chain does (`chainTree`); parts of the map not connected
 * to the roots are not the chain.
 */
export function chainFromHome(
  systems: Iterable<Pick<MapSystemDto, 'solarSystemId' | 'status' | 'visible' | 'createdAt'>>,
  connections: Iterable<Pick<ConnectionDto, 'source' | 'target'>>,
): Set<number> {
  const shown = [...systems].filter((s) => s.visible);
  const known = new Set(shown.map((s) => s.solarSystemId));
  const homes = shown.filter((s) => s.status === 'home');
  const oldest = [...shown].sort((a, b) => a.createdAt - b.createdAt || a.solarSystemId - b.solarSystemId)[0];
  const roots = homes.length > 0 ? homes : oldest ? [oldest] : [];
  const links = new Map<number, number[]>();
  for (const c of connections) {
    if (!known.has(c.source) || !known.has(c.target)) continue;
    for (const [from, to] of [
      [c.source, c.target],
      [c.target, c.source],
    ] as const) {
      const list = links.get(from);
      if (list) list.push(to);
      else links.set(from, [to]);
    }
  }
  const chain = new Set(roots.map((r) => r.solarSystemId));
  const queue = [...chain];
  for (let i = 0; i < queue.length; i++) {
    for (const next of links.get(queue[i]!) ?? []) {
      if (chain.has(next)) continue;
      chain.add(next);
      queue.push(next);
    }
  }
  return chain;
}
