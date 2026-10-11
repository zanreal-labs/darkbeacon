import type { ConnectionDto, MapSnapshot, MapSystemDto, TypedEvent } from '@wormwright/shared';
import type { StreamMessage } from '../lib/realtime';

export interface MapState {
  systems: Map<number, MapSystemDto>;
  connections: Map<string, ConnectionDto>;
}

export const emptyMapState = (): MapState => ({ systems: new Map(), connections: new Map() });

/** Applies a snapshot or event of a `map:<id>` stream. Upserts, so replays are harmless. */
export function applyMapMessage(state: MapState, message: StreamMessage): MapState {
  if (message.op === 'snapshot') {
    const data = message.data as MapSnapshot;
    return {
      systems: new Map((data.systems ?? []).map((s) => [s.solarSystemId, s])),
      connections: new Map((data.connections ?? []).map((c) => [c.id, c])),
    };
  }
  if (message.op !== 'event') return state;
  const event = message.event as TypedEvent;
  switch (event.type) {
    case 'system.added':
    case 'system.updated': {
      const systems = new Map(state.systems).set(event.data.solarSystemId, event.data);
      return { ...state, systems };
    }
    case 'system.removed': {
      const systems = new Map(state.systems);
      systems.delete(event.data.solarSystemId);
      return { ...state, systems };
    }
    case 'connection.added':
    case 'connection.updated': {
      const connections = new Map(state.connections).set(event.data.id, event.data);
      return { ...state, connections };
    }
    case 'connection.removed': {
      const connections = new Map(state.connections);
      connections.delete(event.data.id);
      return { ...state, connections };
    }
    default:
      return state;
  }
}
