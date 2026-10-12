import type { McpMode, ShareScope } from '@darkbeacon/shared';

/** A map's public link and what it shows. One per map. */
export interface MapShare {
  mapId: string;
  enabled: boolean;
  /** Unguessable part of `/p/<token>`; null until sharing is first switched on. */
  token: string | null;
  slug: string | null;
  scopes: ShareScope[];
  noindex: boolean;
  mcpMode: McpMode;
  updatedAt: number | null;
  updatedBy: string | null;
}

/** Safe defaults: the chain and how its holes are doing; nothing about people or what they know. */
export const DEFAULT_SHARE_SCOPES: readonly ShareScope[] = ['topology', 'connectionStatus'];

/** 32 base62 characters, about 190 bits. */
export const SHARE_TOKEN_LENGTH = 32;

export function defaultShare(mapId: string): MapShare {
  return {
    mapId,
    enabled: false,
    token: null,
    slug: null,
    scopes: [...DEFAULT_SHARE_SCOPES],
    noindex: true,
    mcpMode: 'authenticated',
    updatedAt: null,
    updatedBy: null,
  };
}

/** `topology` is always part of a share; the rest in a stable order, without repeats. */
export function normalizeScopes(scopes: readonly ShareScope[]): ShareScope[] {
  const order: ShareScope[] = ['topology', 'connectionStatus', 'signatures', 'intel', 'characters', 'labels'];
  const wanted = new Set<ShareScope>(['topology', ...scopes]);
  return order.filter((s) => wanted.has(s));
}

/** A public link is a token (32 base62) or a slug (lowercase words). */
export function looksLikeToken(id: string): boolean {
  return /^[0-9A-Za-z]{32}$/.test(id);
}

/** The effective MCP reach of a map: the lower of the instance mode and the map's own. */
export function effectiveMcpMode(instance: McpMode, map: McpMode): McpMode {
  const rank: Record<McpMode, number> = { off: 0, authenticated: 1, public: 2 };
  return rank[instance] <= rank[map] ? instance : map;
}
