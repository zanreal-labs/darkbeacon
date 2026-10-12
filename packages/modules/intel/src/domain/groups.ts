import { isPlayerCorporation, type Killmail } from './killmail.js';

/** A corporation or alliance on killmails: kills as an attacker, losses as the victim. */
export interface ActiveGroup {
  kind: 'corporation' | 'alliance';
  id: number;
  kills: number;
  losses: number;
}

/** A group of pilots as people name it: their alliance, or their corporation when it has none. */
function groupOf(corporationId: number | null, allianceId: number | null) {
  if (allianceId !== null) return { kind: 'alliance' as const, id: allianceId };
  return isPlayerCorporation(corporationId) ? { kind: 'corporation' as const, id: corporationId } : null;
}

/**
 * Who is flying in a system: the groups on its killmails since `since`, busiest first. A group
 * counts once per killmail on each side; NPC corporations are left out.
 */
export function activeGroups(kills: readonly Killmail[], since: number, limit = 8): ActiveGroup[] {
  const groups = new Map<string, ActiveGroup>();
  const bump = (g: { kind: ActiveGroup['kind']; id: number } | null, field: 'kills' | 'losses') => {
    if (!g) return;
    const key = `${g.kind}:${g.id}`;
    const entry = groups.get(key) ?? { ...g, kills: 0, losses: 0 };
    entry[field] += 1;
    groups.set(key, entry);
  };
  for (const kill of kills) {
    if (kill.time < since) continue;
    const victim = groupOf(kill.victim.corporationId, kill.victim.allianceId);
    bump(victim, 'losses');
    const seen = new Set<string>();
    for (const attacker of kill.attackers) {
      const g = groupOf(attacker.corporationId, attacker.allianceId);
      if (!g) continue;
      const key = `${g.kind}:${g.id}`;
      // A group shooting its own (awox) still counts once on each side.
      if (seen.has(key)) continue;
      seen.add(key);
      bump(g, 'kills');
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.kills + b.losses - (a.kills + a.losses) || b.kills - a.kills || a.id - b.id)
    .slice(0, limit);
}
