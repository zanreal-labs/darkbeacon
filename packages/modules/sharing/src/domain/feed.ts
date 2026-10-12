import type { DomainEvent } from '@darkbeacon/core';
import type { EventPayloads } from '@darkbeacon/shared';
import { pairKey, signatureKey } from './keys.js';

/** What to read again from a source after one of its events (mirrors the ports' `ChainSelector`). */
export type FeedSelector =
  | { kind: 'system' | 'connection' | 'signature' | 'character'; key: string }
  | { kind: 'connection' | 'signature'; all: true; solarSystemId?: number };

/** A map event's meaning for the maps that merge it. */
export type FeedSignal =
  | { kind: 'objects'; selectors: FeedSelector[] }
  /** The map's name, settings or Labels changed: merged maps show its name and label names. */
  | { kind: 'renamed' }
  | { kind: 'removed' }
  | null;

type Data<K extends keyof EventPayloads> = EventPayloads[K];

/**
 * Turns an event of a source map's stream into what to read again. Changes come back as current
 * state (never from the payload), so events may arrive late, twice or out of order.
 */
export function feedSignal(event: Pick<DomainEvent, 'type' | 'data'>): FeedSignal {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'system.updated':
      return {
        kind: 'objects',
        selectors: [{ kind: 'system', key: String((d as Data<'system.updated'>).solarSystemId) }],
      };
    case 'system.added':
    case 'system.removed': {
      // Shown or hidden: the system's signatures follow it.
      const id = (d as Data<'system.removed'>).solarSystemId;
      return {
        kind: 'objects',
        selectors: [
          { kind: 'system', key: String(id) },
          { kind: 'signature', all: true, solarSystemId: id },
        ],
      };
    }
    case 'connection.added':
    case 'connection.updated': {
      const c = d as Data<'connection.updated'>;
      return { kind: 'objects', selectors: [{ kind: 'connection', key: pairKey(c.source, c.target) }] };
    }
    case 'connection.removed':
      // Only the id is left: every connection of the source is read again (and the gone one found).
      return { kind: 'objects', selectors: [{ kind: 'connection', all: true }] };
    case 'signature.added':
    case 'signature.updated': {
      const s = d as Data<'signature.updated'>;
      return {
        kind: 'objects',
        selectors: [
          { kind: 'signature', key: signatureKey(s.solarSystemId, s.eveId) },
          // A typed or linked signature names the wormhole type of its connection.
          { kind: 'connection', all: true, solarSystemId: s.solarSystemId },
          // A changed code leaves the old one behind.
          { kind: 'signature', all: true, solarSystemId: s.solarSystemId },
        ],
      };
    }
    case 'signature.removed': {
      const s = d as Data<'signature.removed'>;
      return {
        kind: 'objects',
        selectors: [
          { kind: 'signature', all: true, solarSystemId: s.solarSystemId },
          { kind: 'connection', all: true, solarSystemId: s.solarSystemId },
        ],
      };
    }
    case 'character.tracked':
    case 'character.untracked':
    case 'character.moved':
    case 'character.ship_changed':
    case 'character.online_changed':
    case 'character.docked_changed':
      return { kind: 'objects', selectors: [{ kind: 'character', key: String(d.characterId) }] };
    // A deleted map leaves the maps that merge it (its source reads empty), and comes back with
    // a restore: both read the map again, like a rename. Labels cross by name: a renamed or
    // removed one reads differently everywhere.
    case 'map.settings_changed':
    case 'map.trashed':
    case 'map.restored':
    case 'system_labels.changed':
      return { kind: 'renamed' };
    case 'map.removed':
      return { kind: 'removed' };
    default:
      return null;
  }
}
