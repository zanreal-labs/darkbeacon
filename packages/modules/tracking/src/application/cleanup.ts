import { mapStream, newEvent, type ActorRef } from '@wormwright/core';
import type { TrackedCharacter } from '../domain/presence.js';
import type {
  CharacterTokenSource,
  Clock,
  EventLog,
  TrackingRepository,
  UnitOfWork,
} from '../ports/index.js';

export interface UntrackDeps {
  tracking: TrackingRepository;
  events: EventLog;
  uow: UnitOfWork;
}

/** Stops tracking these entries and announces `character.untracked` on their maps. */
export async function untrack(
  deps: UntrackDeps,
  entries: readonly TrackedCharacter[],
  actor: ActorRef,
  now: number,
): Promise<void> {
  if (entries.length === 0) return;
  await deps.uow.transaction(async () => {
    for (const entry of entries) await deps.tracking.setTracked(entry, false);
    await deps.events.append(
      entries.map((entry) =>
        newEvent({
          stream: mapStream(entry.mapId),
          type: 'character.untracked',
          actor,
          data: { characterId: entry.characterId },
          occurredAt: now,
        }),
      ),
    );
  });
}

/** Reactions to other modules' events that end tracking. */
export class TrackingCleanup {
  private readonly actor: ActorRef = { kind: 'system', id: 'tracking' };

  constructor(private readonly deps: UntrackDeps & { characters: CharacterTokenSource; clock: Clock }) {}

  /** The map was deleted (`map.removed`): nothing is tracked on it any more. */
  forgetMap(mapId: string): Promise<void> {
    return this.deps.tracking.untrackMap(mapId);
  }

  /**
   * The character left the account that tracked it (`character.unlinked`): it was unlinked or a
   * new owner claimed it. Its location must not reach the former owner's maps any more.
   */
  async forgetCharacter(characterId: number): Promise<void> {
    const { tracking, characters, clock } = this.deps;
    const owner = await characters.character(characterId);
    const stale = (await tracking.listTracked()).filter(
      (t) => t.characterId === characterId && t.accountId !== owner?.accountId,
    );
    await untrack(this.deps, stale, this.actor, clock.now());
    const presence = await tracking.getPresence(characterId);
    if (presence && presence.accountId !== owner?.accountId) await tracking.deletePresence(characterId);
  }
}
