/** Who claims a system, as ESI's `GET /sovereignty/systems` says. Unclaimed systems have no claim. */
export type SovereigntyClaim =
  | { kind: 'alliance'; allianceId: number; corporationId: number | null }
  | { kind: 'faction'; factionId: number };

export function sameClaim(a: SovereigntyClaim | null, b: SovereigntyClaim | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'alliance' && b.kind === 'alliance')
    return a.allianceId === b.allianceId && a.corporationId === b.corporationId;
  return a.kind === 'faction' && b.kind === 'faction' && a.factionId === b.factionId;
}

/** What the map needs to know of a system to decide whether its claim is worth showing. */
export interface SpaceFacts {
  security: number;
  /**
   * The SDE's wormhole class: 1-6 and 12-18 (Thera, shattered, drifter) are wormhole space, 7-9
   * high-, low- and null-sec, 10-11 the special k-space regions, 25 Pochven.
   */
  whClass: number | null;
  region: string;
}

/** Wormhole space as players mean it: classes 1-6, Thera, the shattered and drifter systems. */
export function isWormholeSpace(space: Pick<SpaceFacts, 'whClass'> | null): boolean {
  const c = space?.whClass ?? null;
  return c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));
}

/** Null-sec and Pochven: where sovereignty and faction space mean something. */
export function isNullSec(space: SpaceFacts | null): boolean {
  if (!space || isWormholeSpace(space)) return false;
  return space.whClass === 25 || space.security < 0.05;
}

/**
 * The claim a node shows: every alliance claim, and faction claims outside high- and low-sec (NPC
 * null-sec, Pochven). Empire factions own all of high- and low-sec, so naming them on every node
 * would be noise. Wormhole space has no sovereignty.
 */
export function shownClaim(
  claim: SovereigntyClaim | null,
  space: SpaceFacts | null,
): SovereigntyClaim | null {
  if (!claim || !space || isWormholeSpace(space)) return null;
  if (claim.kind === 'alliance') return claim;
  return isNullSec(space) ? claim : null;
}

/** The alliance holding most of a region's null-sec systems, and how many of how many. */
export interface RegionHolder {
  allianceId: number;
  held: number;
  total: number;
}

/**
 * Who dominates each region: the alliance with the most claimed null-sec systems in it, if no
 * other alliance holds as many (a tie names nobody). Shown for unclaimed null-sec systems.
 */
export function regionHolders(
  systems: Iterable<{ id: number; space: SpaceFacts }>,
  claims: ReadonlyMap<number, SovereigntyClaim>,
): Map<string, RegionHolder> {
  const totals = new Map<string, number>();
  const held = new Map<string, Map<number, number>>();
  for (const { id, space } of systems) {
    if (!isNullSec(space) || space.whClass === 25) continue;
    totals.set(space.region, (totals.get(space.region) ?? 0) + 1);
    const claim = claims.get(id);
    if (claim?.kind !== 'alliance') continue;
    const counts = held.get(space.region) ?? new Map<number, number>();
    counts.set(claim.allianceId, (counts.get(claim.allianceId) ?? 0) + 1);
    held.set(space.region, counts);
  }
  const result = new Map<string, RegionHolder>();
  for (const [region, counts] of held) {
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    if (!top || (second && second[1] === top[1])) continue;
    result.set(region, { allianceId: top[0], held: top[1], total: totals.get(region) ?? top[1] });
  }
  return result;
}

/**
 * A faction's name as players say it: "Guristas Pirates" -> "Guristas", "The Blood Raider
 * Covenant" -> "Blood Raider", "Sansha's Nation" -> "Sansha", "CONCORD Assembly" -> "CONCORD".
 */
export function factionShortName(name: string): string {
  const words = name
    .trim()
    .replace(/^The\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name;
  const first = words[0]!.replace(/'s$/i, '');
  // Two-word names whose first word alone is not what people say.
  if (/^blood$/i.test(first) && words[1]) return `${first} ${words[1]}`;
  return first;
}
