import { describe, expect, it } from 'vitest';
import type { StreamMessage } from '../lib/realtime';
import { connectionFixture, eventMessage, signatureFixture, systemFixture } from '../test/fixtures';
import { applyMapMessage, emptyMapState, homeSystem, seedCharacters, type MapState } from './mapState';
import { confirmPending, settlePending, withPending, type PendingChange } from './optimistic';

const STREAM = 'map:map-1';
const apply = (state: MapState, message: object) => applyMapMessage(state, message as StreamMessage);

const presence = (characterId: number, solarSystemId: number | null) => ({
  characterId,
  accountId: 'a',
  name: `c${characterId}`,
  solarSystemId,
  shipTypeId: null,
  shipName: null,
  online: true,
  updatedAt: 1,
});

describe('applyMapMessage', () => {
  it('replaces state from a snapshot and keeps parts the snapshot lacks', () => {
    let state = seedCharacters(emptyMapState(), [presence(7, 1)]);
    state = apply(state, {
      op: 'snapshot',
      stream: STREAM,
      seq: 3,
      data: { systems: [systemFixture(1)], connections: [connectionFixture('c', 1, 2)] },
    });
    expect([...state.systems.keys()]).toEqual([1]);
    expect(state.connections.has('c')).toBe(true);
    expect(state.characters.has(7)).toBe(true);
    expect(state.has).toEqual({ signatures: false, characters: false });
  });

  it('upserts and removes on events, and follows tracked characters', () => {
    let state = apply(emptyMapState(), {
      op: 'snapshot',
      stream: STREAM,
      seq: 0,
      data: { systems: [], connections: [], signatures: [], characters: [presence(7, 1)] },
    });
    state = apply(state, eventMessage(STREAM, 'system.added', systemFixture(1)));
    state = apply(state, eventMessage(STREAM, 'system.updated', systemFixture(1, { tag: 'X' })));
    state = apply(state, eventMessage(STREAM, 'signature.added', signatureFixture('s', 1, 'ABC-123')));
    state = apply(state, eventMessage(STREAM, 'character.moved', { characterId: 7, from: 1, to: 2 }, 50));
    state = apply(state, eventMessage(STREAM, 'character.moved', { characterId: 99, from: 1, to: 2 }));
    expect(state.systems.get(1)?.tag).toBe('X');
    expect(state.signatures.size).toBe(1);
    expect(state.characters.get(7)).toMatchObject({ solarSystemId: 2, updatedAt: 50 });
    expect(state.characters.has(99)).toBe(false);

    state = apply(state, eventMessage(STREAM, 'signature.removed', { id: 's', solarSystemId: 1 }));
    state = apply(state, eventMessage(STREAM, 'system.removed', { solarSystemId: 1 }));
    expect(state.signatures.size).toBe(0);
    expect(state.systems.size).toBe(0);
    expect(state.has).toEqual({ signatures: true, characters: true });
  });

  it('takes the map’s message of the day as it changes, and leaves it out once cleared', () => {
    const map = {
      id: 'map-1',
      slug: 'home',
      name: 'Home',
      ownerAccountId: 'a',
      settings: { scopes: ['wormhole'] },
      labels: [],
      systemLabels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    let state = apply(emptyMapState(), {
      op: 'snapshot',
      stream: STREAM,
      seq: 0,
      data: { map, systems: [], connections: [] },
    });
    state = apply(state, eventMessage(STREAM, 'motd.changed', { motd: 'Comms: **Ops**' }));
    expect(state.map?.motd).toBe('Comms: **Ops**');
    state = apply(state, eventMessage(STREAM, 'motd.changed', { motd: '' }));
    expect(state.map).toEqual(map);
  });
});

describe('pending changes', () => {
  const change = (id: number, status: 'hostile' | 'home'): PendingChange => ({
    id,
    apply: (s) => ({ ...s, systems: new Map(s.systems).set(1, systemFixture(1, { status })) }),
    confirmedBy: (e) => e.type === 'system.updated',
    settled: false,
    confirmed: false,
  });
  const event = eventMessage(STREAM, 'system.updated', systemFixture(1)).event as never;

  it('stay until both the request and the event are done, in either order', () => {
    let pending = [change(1, 'hostile')];
    pending = confirmPending(pending, event);
    expect(pending).toHaveLength(1);
    expect(settlePending(pending, 1)).toHaveLength(0);

    pending = settlePending([change(2, 'home')], 2);
    expect(confirmPending(pending, event)).toHaveLength(0);
  });

  it('apply on top of the confirmed state in order', () => {
    const state = withPending(emptyMapState(), [change(1, 'hostile'), change(2, 'home')]);
    expect(state.systems.get(1)?.status).toBe('home');
  });
});

describe('homeSystem', () => {
  const systems = (...list: ReturnType<typeof systemFixture>[]) =>
    new Map(list.map((s) => [s.solarSystemId, s]));

  it('is the oldest home system', () => {
    const found = homeSystem(
      systems(
        systemFixture(1, { createdAt: 1 }),
        systemFixture(2, { status: 'home', createdAt: 5 }),
        systemFixture(3, { status: 'home', createdAt: 3 }),
      ),
    );
    expect(found?.solarSystemId).toBe(3);
  });

  it('is the oldest visible system on a map without home, and nothing on an empty one', () => {
    const found = homeSystem(
      systems(
        systemFixture(1, { createdAt: 1, visible: false }),
        systemFixture(2, { createdAt: 4 }),
        systemFixture(3, { createdAt: 2 }),
      ),
    );
    expect(found?.solarSystemId).toBe(3);
    expect(homeSystem(new Map())).toBeUndefined();
  });
});
