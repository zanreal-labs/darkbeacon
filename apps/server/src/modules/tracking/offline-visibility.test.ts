import { describe, expect, it } from 'vitest';
import type { Actor, DomainEvent, MapAccess, MapRole } from '@darkbeacon/core';
import type { MapRepository } from '@darkbeacon/mapping';
import type { CharacterPresenceDto } from '@darkbeacon/shared';
import type { TrackingRepository } from '@darkbeacon/tracking';
import { OfflineVisibility } from './offline-visibility.js';

const presence = (characterId: number, online: boolean): CharacterPresenceDto => ({
  characterId,
  accountId: 'a',
  name: `c${characterId}`,
  solarSystemId: 31000101,
  shipTypeId: null,
  shipName: null,
  online,
  updatedAt: 1,
});

function setup(hide: boolean, role: MapRole) {
  const stored = new Map([
    [1, presence(1, true)],
    [2, presence(2, false)],
  ]);
  const maps = {
    findById: async () => ({ settings: { scopes: [], offlineForManagersOnly: hide } }),
  } as unknown as MapRepository;
  const access = { roleOf: async () => role, mapsFor: async () => [] } as MapAccess;
  const tracking = {
    getPresence: async (id: number) => stored.get(id) ?? null,
  } as unknown as TrackingRepository;
  return new OfflineVisibility(maps, access, tracking);
}

const actor: Actor = { kind: 'account', id: 'v', instanceRole: 'user' };
const event = (type: string, data: unknown): DomainEvent => ({
  id: 'e',
  seq: 1,
  stream: 'map:m',
  type,
  occurredAt: 1,
  actor: { kind: 'system', id: 'tracking' },
  data,
  v: 1,
});

describe('offline characters for managers only', () => {
  it('turns going offline into untracked and coming online into tracked for viewers', async () => {
    const v = setup(true, 'viewer');
    expect(
      await v.filterEvent(actor, 'm', event('character.online_changed', { characterId: 2, online: false })),
    ).toMatchObject({ type: 'character.untracked', data: { characterId: 2 } });
    expect(
      await v.filterEvent(actor, 'm', event('character.online_changed', { characterId: 1, online: true })),
    ).toMatchObject({ type: 'character.tracked', data: { characterId: 1, online: true, name: 'c1' } });
    expect(await v.filterEvent(actor, 'm', event('character.tracked', presence(2, false)))).toBeNull();
    expect(
      await v.filterEvent(actor, 'm', event('character.moved', { characterId: 2, from: 1, to: 2 })),
    ).toBeNull();
    expect(
      await v.filterEvent(actor, 'm', event('character.moved', { characterId: 1, from: 1, to: 2 })),
    ).not.toBeNull();
    expect(await v.filterList(actor, 'm', [presence(1, true), presence(2, false)])).toHaveLength(1);
    // Other events pass untouched.
    const other = event('system.added', {});
    expect(await v.filterEvent(actor, 'm', other)).toBe(other);
  });

  it('changes nothing for managers or on maps without the option', async () => {
    const offline = event('character.tracked', presence(2, false));
    expect(await setup(true, 'manager').filterEvent(actor, 'm', offline)).toBe(offline);
    expect(await setup(false, 'viewer').filterEvent(actor, 'm', offline)).toBe(offline);
  });
});
