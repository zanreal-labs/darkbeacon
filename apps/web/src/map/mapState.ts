import type {
  CharacterPresenceDto,
  ConnectionDto,
  MapDto,
  MapExitDto,
  MapSnapshot,
  MapSystemDto,
  SignatureDto,
  TypedEvent,
} from '@darkbeacon/shared';
import type { StreamMessage } from '../lib/realtime';

export interface MapState {
  map: MapDto | null;
  systems: Map<number, MapSystemDto>;
  connections: Map<string, ConnectionDto>;
  signatures: Map<string, SignatureDto>;
  characters: Map<number, CharacterPresenceDto>;
  /** The chain's exits as the routing API computed them; null until the server sent them. */
  exits: MapExitDto[] | null;
  /** Snapshot parts the server sent; a missing part is loaded over REST instead. */
  has: { signatures: boolean; characters: boolean };
}

export const emptyMapState = (): MapState => ({
  map: null,
  systems: new Map(),
  connections: new Map(),
  signatures: new Map(),
  characters: new Map(),
  exits: null,
  has: { signatures: false, characters: false },
});

const byKey = <K, V>(items: readonly V[] | undefined, key: (v: V) => K) =>
  new Map((items ?? []).map((v) => [key(v), v]));

function upsert<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value);
}

function without<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function patchCharacter(
  state: MapState,
  characterId: number,
  patch: Partial<CharacterPresenceDto>,
  at: number,
): MapState {
  const current = state.characters.get(characterId);
  // Characters not in the snapshot are unknown to this client; the next snapshot brings them.
  if (!current) return state;
  return {
    ...state,
    characters: upsert(state.characters, characterId, { ...current, ...patch, updatedAt: at }),
  };
}

/** Applies a snapshot or event of a `map:<id>` stream. Events upsert, so replays are harmless. */
export function applyMapMessage(state: MapState, message: StreamMessage): MapState {
  if (message.op === 'snapshot') {
    const data = message.data as MapSnapshot;
    return {
      map: data.map ?? state.map,
      systems: byKey(data.systems, (s) => s.solarSystemId),
      connections: byKey(data.connections, (c) => c.id),
      signatures: data.signatures ? byKey(data.signatures, (s) => s.id) : state.signatures,
      characters: data.characters ? byKey(data.characters, (c) => c.characterId) : state.characters,
      exits: data.exits ?? state.exits,
      has: {
        signatures: state.has.signatures || data.signatures !== undefined,
        characters: state.has.characters || data.characters !== undefined,
      },
    };
  }
  if (message.op !== 'event') return state;
  return applyMapEvent(state, message.event as TypedEvent);
}

export function applyMapEvent(state: MapState, event: TypedEvent): MapState {
  switch (event.type) {
    case 'system.added':
    case 'system.updated':
      return { ...state, systems: upsert(state.systems, event.data.solarSystemId, event.data) };
    case 'system.removed':
      return { ...state, systems: without(state.systems, event.data.solarSystemId) };
    case 'connection.added':
    case 'connection.updated':
      return { ...state, connections: upsert(state.connections, event.data.id, event.data) };
    case 'connection.removed':
      return { ...state, connections: without(state.connections, event.data.id) };
    case 'signature.added':
    case 'signature.updated':
      return { ...state, signatures: upsert(state.signatures, event.data.id, event.data) };
    case 'signature.removed':
      return { ...state, signatures: without(state.signatures, event.data.id) };
    case 'character.moved':
      return patchCharacter(
        state,
        event.data.characterId,
        { solarSystemId: event.data.to },
        event.occurredAt,
      );
    case 'character.ship_changed':
      return patchCharacter(
        state,
        event.data.characterId,
        { shipTypeId: event.data.shipTypeId, shipName: event.data.shipName },
        event.occurredAt,
      );
    case 'character.online_changed':
      return patchCharacter(state, event.data.characterId, { online: event.data.online }, event.occurredAt);
    case 'character.tracked':
      return { ...state, characters: upsert(state.characters, event.data.characterId, event.data) };
    case 'character.untracked':
      return { ...state, characters: without(state.characters, event.data.characterId) };
    case 'map.created':
    case 'map.settings_changed':
      return { ...state, map: event.data };
    case 'routes.exits_changed':
      return { ...state, exits: event.data.exits };
    case 'labels.changed':
      return state.map ? { ...state, map: { ...state.map, labels: event.data.labels } } : state;
    default:
      return state;
  }
}

/** Fills a part the snapshot did not carry (loaded over REST). Stream data wins over it. */
export function seedSignatures(state: MapState, signatures: readonly SignatureDto[]): MapState {
  const merged = byKey(signatures, (s) => s.id);
  for (const [id, s] of state.signatures) merged.set(id, s);
  return { ...state, signatures: merged };
}

export function seedCharacters(state: MapState, characters: readonly CharacterPresenceDto[]): MapState {
  const merged = byKey(characters, (c) => c.characterId);
  for (const [id, c] of state.characters) merged.set(id, c);
  return { ...state, characters: merged };
}
