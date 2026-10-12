/** Someone on a killmail: the victim, or the attacker who landed the final blow. */
export interface KillParty {
  characterId: number | null;
  corporationId: number | null;
  allianceId: number | null;
  factionId: number | null;
  shipTypeId: number | null;
}

/** Attackers of one corporation (NPCs without one are grouped by faction, else left out). */
export interface AttackerGroup {
  corporationId: number | null;
  allianceId: number | null;
  pilots: number;
}

/**
 * What is kept of a killmail: enough for the kill list, "who is active" and a link to zKillboard.
 * Items, positions, damage and every attacker but the final blow are dropped.
 */
export interface Killmail {
  id: number;
  /** zKillboard's (and ESI's) hash of the killmail. */
  hash: string;
  systemId: number;
  /** epoch ms */
  time: number;
  /** zKillboard's estimate in ISK. */
  value: number | null;
  /** Killed by NPCs only. */
  npc: boolean;
  solo: boolean;
  victim: KillParty;
  finalBlow: KillParty | null;
  attackerCount: number;
  /** Attackers per corporation, most pilots first. */
  attackers: AttackerGroup[];
}

/** Attacker groups kept per killmail; a blob of more corporations keeps its largest ones. */
export const MAX_ATTACKER_GROUPS = 50;

/**
 * NPC corporations have ids from 1 000 000 to 1 999 999 (ESI's id ranges); they are not "who is
 * active" in a system.
 */
export function isPlayerCorporation(id: number | null): id is number {
  return id !== null && id >= 2_000_000;
}

/** The attackers of a killmail per corporation, most pilots first (ties: lower id first). */
export function groupAttackers(attackers: readonly KillParty[]): AttackerGroup[] {
  const groups = new Map<number, AttackerGroup>();
  for (const a of attackers) {
    if (a.corporationId === null) continue;
    const group = groups.get(a.corporationId);
    if (group) group.pilots += 1;
    else groups.set(a.corporationId, { corporationId: a.corporationId, allianceId: a.allianceId, pilots: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.pilots - a.pilots || (a.corporationId ?? 0) - (b.corporationId ?? 0))
    .slice(0, MAX_ATTACKER_GROUPS);
}

/** Every id a killmail names that a reader needs a name for. */
export function killmailIds(kill: Killmail): number[] {
  const parties = [kill.victim, ...(kill.finalBlow ? [kill.finalBlow] : [])];
  return [
    ...parties.flatMap((p) => [p.characterId, p.corporationId, p.allianceId, p.factionId, p.shipTypeId]),
    ...kill.attackers.slice(0, 5).flatMap((g) => [g.corporationId, g.allianceId]),
  ].filter((id): id is number => id !== null);
}
