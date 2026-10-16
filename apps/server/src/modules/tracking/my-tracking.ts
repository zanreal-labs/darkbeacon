import { hasMapRole, requireAccount, type Actor } from '@darkbeacon/core';
import type { CharacterService } from '@darkbeacon/identity';
import type { MapUseCases } from '@darkbeacon/mapping';
import type { MyTrackingDto, OnlineCountsDto } from '@darkbeacon/shared';
import type { TrackingProblemStore, TrackingRepository } from '@darkbeacon/tracking';

/**
 * Views across maps that join identity (my characters), mapping (the maps I can see) and
 * tracking (where characters are): the cross-map tracking page and the maps list's online count.
 */
export class TrackingOverview {
  constructor(
    private readonly deps: {
      characters: Pick<CharacterService, 'listForAccount'>;
      maps: Pick<MapUseCases, 'list'>;
      tracking: TrackingRepository;
      problems?: TrackingProblemStore;
    },
  ) {}

  async mine(actor: Actor | null): Promise<MyTrackingDto> {
    const account = requireAccount(actor);
    const [characters, maps, tracked] = await Promise.all([
      this.deps.characters.listForAccount(account.id),
      this.deps.maps.list(actor),
      this.deps.tracking.listTracked(),
    ]);
    const visible = new Set(maps.map((m) => m.id));
    const ids = characters.map((c) => c.id);
    const [presences, problemList] = await Promise.all([
      this.deps.tracking.listPresence(ids),
      this.deps.problems?.list(ids) ?? [],
    ]);
    const presence = new Map(presences.map((p) => [p.characterId, p]));
    const problems = new Map(problemList.map(({ characterId, ...problem }) => [characterId, problem]));
    return {
      characters: characters.map((c) => {
        const p = presence.get(c.id);
        // Presence written for a former owner of the character is not mine to see.
        const own = p && p.accountId === account.id ? p : undefined;
        return {
          characterId: c.id,
          solarSystemId: own?.solarSystemId ?? null,
          shipTypeId: own?.shipTypeId ?? null,
          shipName: own?.shipName ?? null,
          online: own ? own.online : null,
          docked: own?.docked ?? null,
          updatedAt: own?.updatedAt ?? null,
          trackedOn: tracked
            .filter((t) => t.characterId === c.id && t.accountId === account.id && visible.has(t.mapId))
            .map((t) => t.mapId),
          ...(problems.has(c.id) ? { problem: problems.get(c.id)! } : {}),
        };
      }),
      maps: maps
        .map((m) => ({ id: m.id, name: m.name, slug: m.slug, canTrack: hasMapRole(m.role, 'member') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Online tracked characters per map the caller can see. */
  async online(actor: Actor | null): Promise<OnlineCountsDto> {
    const maps = await this.deps.maps.list(actor);
    const visible = new Set(maps.map((m) => m.id));
    const tracked = (await this.deps.tracking.listTracked()).filter((t) => visible.has(t.mapId));
    const presence = new Map(
      (await this.deps.tracking.listPresence([...new Set(tracked.map((t) => t.characterId))])).map((p) => [
        p.characterId,
        p,
      ]),
    );
    const counts: Record<string, number> = Object.fromEntries(maps.map((m) => [m.id, 0]));
    for (const t of tracked)
      if (presence.get(t.characterId)?.online) counts[t.mapId] = (counts[t.mapId] ?? 0) + 1;
    return { counts };
  }
}
