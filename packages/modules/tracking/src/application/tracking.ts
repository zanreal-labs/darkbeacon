import {
  actorRef,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  type Actor,
} from '@darkbeacon/core';
import type { CharacterPresenceDto, SetTrackingRequest } from '@darkbeacon/shared';
import type { CharacterPresence } from '../domain/presence.js';
import type {
  CharacterTokenSource,
  Clock,
  EventLog,
  MapAccess,
  TrackingRepository,
  UnitOfWork,
} from '../ports/index.js';

/**
 * Starts (member+) or stops tracking one of the caller's own characters on a map. Stopping
 * needs no map role, so an account that lost access can still take its character off a map.
 */
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
    if (input.tracked) await requireMapRole(access, account, mapId, 'member');
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
      const stored = await tracking.getPresence(input.characterId);
      if (!input.tracked) {
        await events.append([
          newEvent({
            ...base,
            type: 'character.untracked',
            data: { characterId: input.characterId },
            before: stored ?? { characterId: input.characterId, name: owner.name },
          }),
        ]);
        return;
      }
      const presence: CharacterPresence = {
        ...(stored ?? blankPresence(input.characterId, now)),
        accountId: account.id,
        name: owner.name,
      };
      if (presence.accountId !== stored?.accountId || presence.name !== stored.name) {
        await tracking.savePresence(presence);
      }
      const [shown] = await withAffiliation(characters, [presence]);
      await events.append([newEvent({ ...base, type: 'character.tracked', data: shown ?? presence })]);
    });
  }
}

/** Characters tracked on a map with their last known presence (viewer+). */
export class ListMapCharacters {
  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      access: MapAccess;
      /** Adds corporation and alliance when given. */
      characters?: CharacterTokenSource;
    },
  ) {}

  async execute(actor: Actor | null, mapId: string): Promise<CharacterPresenceDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return this.forMap(mapId);
  }

  /** Without authorization, for snapshots of an already authorized stream. */
  async forMap(mapId: string): Promise<CharacterPresenceDto[]> {
    const tracked = await this.deps.tracking.listTrackedOnMap(mapId);
    const presence = await this.deps.tracking.listPresence(tracked.map((t) => t.characterId));
    const shown = this.deps.characters ? await withAffiliation(this.deps.characters, presence) : presence;
    return shown.sort((a, b) => a.name.localeCompare(b.name) || a.characterId - b.characterId);
  }
}

/** A character tracked on a map, for the map's managers: whose it is and since when. */
export interface MapTrackedCharacter extends CharacterPresenceDto {
  since: number;
}

/**
 * The map's characters page (Wanderer's, for managers): every character tracked on the map with
 * the account it belongs to, and taking someone else's character off the map.
 */
export class ManageMapTracking {
  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      access: MapAccess;
      events: EventLog;
      uow: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async list(actor: Actor | null, mapId: string): Promise<MapTrackedCharacter[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    const tracked = await this.deps.tracking.listTrackedOnMap(mapId);
    const presence = new Map(
      (await this.deps.tracking.listPresence(tracked.map((t) => t.characterId))).map((p) => [
        p.characterId,
        p,
      ]),
    );
    return tracked
      .map((t) => ({
        ...(presence.get(t.characterId) ?? blankPresence(t.characterId, t.since)),
        accountId: t.accountId,
        since: t.since,
      }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId) || a.name.localeCompare(b.name));
  }

  /** Stops tracking a character on the map, whoever it belongs to (managers). Its owner may track it again. */
  async untrack(actor: Actor | null, mapId: string, characterId: number): Promise<void> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    await this.deps.uow.transaction(async () => {
      const entry = (await this.deps.tracking.listTrackedOnMap(mapId)).find(
        (t) => t.characterId === characterId,
      );
      if (!entry) throw new NotFoundError('Character');
      await this.deps.tracking.setTracked(entry, false);
      const stored = await this.deps.tracking.getPresence(characterId);
      await this.deps.events.append([
        newEvent({
          stream: mapStream(mapId),
          type: 'character.untracked',
          actor: actorRef(actor!),
          data: { characterId },
          occurredAt: this.deps.clock.now(),
          before: stored ?? { characterId },
        }),
      ]);
    });
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

/** Presence with each character's corporation and alliance, as identity knows them. */
export async function withAffiliation(
  characters: CharacterTokenSource,
  presence: readonly CharacterPresenceDto[],
): Promise<CharacterPresenceDto[]> {
  if (!characters.linked || presence.length === 0) return [...presence];
  const linked = new Map((await characters.linked(presence.map((p) => p.characterId))).map((c) => [c.id, c]));
  return presence.map((p) => {
    const c = linked.get(p.characterId);
    return c ? { ...p, corporationId: c.corporationId, allianceId: c.allianceId } : p;
  });
}
