import { describe, expect, it } from 'vitest';
import type { MapSourceDto, ProvenanceDto } from '@darkbeacon/shared';
import type { StreamMessage } from '../../lib/realtime';
import { mapPermissions } from '../../lib/roles';
import { connectionFixture, eventMessage, signatureFixture, systemFixture } from '../../test/fixtures';
import { applyMapMessage, emptyMapState, type MapState } from '../mapState';
import { filterableSources, permissionsFor, withoutSources } from './chain';
import { provenanceText } from './ProvenanceLine';

const STREAM = 'map:alliance';
const apply = (state: MapState, message: object) => applyMapMessage(state, message as StreamMessage);
const fromSharing = (type: string, data: unknown) => {
  const message = eventMessage(STREAM, type, data);
  message.event.actor = { kind: 'system', id: 'sharing' };
  return message;
};

const source = (id: string, name: string): MapSourceDto => ({
  id,
  origin: { instance: 'local', mapId: id },
  name,
  instanceName: null,
  level: 'read',
  scopes: ['topology'],
  hidden: false,
});
const SOURCES = [source('self', 'Alliance chain'), source('a', 'Corp A'), source('b', 'Corp B')];
const prov = (sources: string[], writable = false, updatedBy = sources[0]!): ProvenanceDto => ({
  sources,
  updatedBy,
  updatedAt: 1_000,
  writable,
});

describe('merged maps in the browser', () => {
  it('shows the merged objects and ignores the map’s own events about its rows', () => {
    let state = apply(emptyMapState(), {
      op: 'snapshot',
      stream: STREAM,
      seq: 1,
      data: { systems: [systemFixture(1, { provenance: prov(['a']) })], connections: [], sources: SOURCES },
    });
    expect(state.sources).toEqual(SOURCES);
    // A plain event of the map's own row: not what the merged map shows.
    state = apply(state, eventMessage(STREAM, 'system.updated', systemFixture(1, { tag: 'OWN' })));
    expect(state.systems.get(1)?.tag).toBeNull();
    state = apply(state, eventMessage(STREAM, 'system.removed', { solarSystemId: 1 }));
    expect(state.systems.has(1)).toBe(true);
    // The merge's events change it.
    state = apply(
      state,
      fromSharing('system.updated', systemFixture(1, { tag: 'A', provenance: prov(['a']) })),
    );
    expect(state.systems.get(1)?.tag).toBe('A');
    state = apply(state, fromSharing('system.removed', { solarSystemId: 1 }));
    expect(state.systems.has(1)).toBe(false);
  });

  it('enters merged mode dropping its own rows and leaves it on an empty source list', () => {
    let state = apply(emptyMapState(), {
      op: 'snapshot',
      stream: STREAM,
      seq: 1,
      data: { systems: [systemFixture(1)], connections: [connectionFixture('own', 1, 2)], signatures: [] },
    });
    state = apply(
      state,
      fromSharing('connection.added', {
        ...connectionFixture('c:1-2', 1, 2),
        provenance: prov(['self', 'a']),
      }),
    );
    state = apply(state, fromSharing('map.sources_changed', { sources: SOURCES }));
    expect([...state.connections.keys()]).toEqual(['c:1-2']);
    state = apply(state, fromSharing('map.sources_changed', { sources: [] }));
    expect(state.sources).toBeNull();
  });

  it('lets viewers edit only what a writable source holds, and lock only the map’s own', () => {
    const member = mapPermissions('manager');
    expect(permissionsFor(member, undefined)).toEqual(member);
    expect(permissionsFor(member, prov(['a'], false))).toMatchObject({ edit: false, manage: false });
    expect(permissionsFor(member, prov(['a'], true))).toMatchObject({ edit: true, manage: false });
    expect(permissionsFor(member, prov(['self', 'a'], true))).toMatchObject({ edit: true, manage: true });
    expect(permissionsFor(mapPermissions('viewer'), prov(['a'], true))).toMatchObject({ edit: false });
  });

  it('hides what only hidden sources hold, with its connections and signatures', () => {
    let state = apply(emptyMapState(), {
      op: 'snapshot',
      stream: STREAM,
      seq: 1,
      data: {
        systems: [
          systemFixture(1, { provenance: prov(['a', 'b']) }),
          systemFixture(2, { provenance: prov(['b']) }),
        ],
        connections: [{ ...connectionFixture('c:1-2', 1, 2), provenance: prov(['a', 'b']) }],
        signatures: [{ ...signatureFixture('s:2:ABC-123', 2, 'ABC-123'), provenance: prov(['a']) }],
        sources: SOURCES,
      },
    });
    state = withoutSources(state, new Set(['b']));
    expect([...state.systems.keys()]).toEqual([1]);
    expect(state.connections.size).toBe(0);
    expect(state.signatures.size).toBe(0);
    expect(filterableSources(SOURCES).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('says where an object comes from in one line', () => {
    expect(provenanceText(prov(['a', 'b'], false, 'b'), SOURCES, 61_000)).toBe(
      'Corp A, Corp B · updated by Corp B 1 min ago · read-only',
    );
    expect(provenanceText(prov(['a'], true), SOURCES, 1_000)).toBe('updated by Corp A just now');
  });
});
