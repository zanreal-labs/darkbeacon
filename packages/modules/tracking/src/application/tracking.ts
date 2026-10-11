import {
  actorRef,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  type Actor,
} from '@wormwright/core';
import type { CharacterPresenceDto, SetTrackingRequest } from '@wormwright/shared';
import type { CharacterPresence } from '../domain/presence.js';
import type {
  CharacterTokenSource,
  Clock,
  EventLog,
  MapAccess,
  TrackingRepository,
  UnitOfWork,
} from '../ports/index.js';

/** Starts or stops tracking one of the caller's own characters on a map (member+). */
export class SetTracking {
  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      characters: CharacterTokenSource;
      access: MapAccess;
      events: EventLog;
      uow: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(actor: Actor | null, mapId: string, input: SetTrackingRequest): Promise<void> {
    const { tracking, characters, access, events, uow, clock } = this.deps;
    const account = requireAccount(actor);
    await requireMapRole(access, account, mapId, 'member');
    const owner = await characters.character(input.characterId);
    // Someone else's character is reported like a missing one.
    if (!owner || owner.accountId !== account.id) throw new NotFoundError('Character');

    await uow.transaction(async () => {
      const onMap = await tracking.listTrackedOnMap(mapId);
      if (onMap.some((t) => t.characterId === input.characterId) === input.tracked) return;
      const now = clock.now();
      await tracking.setTracked(
        { mapId, characterId: input.characterId, accountId: account.id, since: now },
        input.tracked,
      );

      const base = { stream: mapStream(mapId), actor: actorRef(account), occurredAt: now };
      if (!input.tracked) {
        await events.append([
          newEvent({ ...base, type: 'character.untracked', data: { characterId: input.characterId } }),
        ]);
        return;
      }
      const stored = await tracking.getPresence(input.characterId);
      const presence: CharacterPresence = {
        ...(stored ?? blankPresence(input.characterId, now)),
        accountId: account.id,
        name: owner.name,
      };
      if (presence.accountId !== stored?.accountId || presence.name !== stored.name) {
        await tracking.savePresence(presence);
      }
      await events.append([newEvent({ ...base, type: 'character.tracked', data: presence })]);
    });
  }
}

/** Characters tracked on a map with their last known presence (viewer+). */
export class ListMapCharacters {
  constructor(private readonly deps: { tracking: TrackingRepository; access: MapAccess }) {}

  async execute(actor: Actor | null, mapId: string): Promise<CharacterPresenceDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return this.forMap(mapId);
  }

  /** Without authorization, for snapshots of an already authorized stream. */
  async forMap(mapId: string): Promise<CharacterPresenceDto[]> {
    const tracked = await this.deps.tracking.listTrackedOnMap(mapId);
    const presence = await this.deps.tracking.listPresence(tracked.map((t) => t.characterId));
    return presence.sort((a, b) => a.name.localeCompare(b.name) || a.characterId - b.characterId);
  }
}

export function blankPresence(characterId: number, now: number): CharacterPresence {
  return {
    characterId,
    accountId: '',
    name: '',
    solarSystemId: null,
    shipTypeId: null,
    shipName: null,
    online: false,
    updatedAt: now,
  };
}
