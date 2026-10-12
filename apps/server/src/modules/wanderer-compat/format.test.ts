import { describe, expect, it } from 'vitest';
import { newId, type DomainEvent } from '@darkbeacon/core';
import type { ConnectionDto } from '@darkbeacon/shared';
import { stableUuid, ULID, ulidOf, wandererEvent, wandererTime, WandererStreamState } from './format.js';

const ctx = { mapId: 'm', labels: new Map(), systemName: (id: number) => `J${id}` };

const event = (type: string, data: unknown): DomainEvent => ({
  id: newId(),
  seq: 1,
  stream: 'map:m',
  type,
  occurredAt: Date.UTC(2026, 9, 12, 12, 0, 0, 875),
  actor: { kind: 'account', id: 'a' },
  data,
  v: 1,
});

describe('Wanderer format', () => {
  it('turns time-ordered ids into ULIDs that sort the same way', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    const ulids = ids.map(ulidOf);
    for (const u of ulids) expect(u).toMatch(ULID);
    expect([...ulids].sort()).toEqual(ulids);
    expect(ulidOf('00000000-0000-7000-8000-000000000000')).toHaveLength(26);
  });

  it('writes Wanderer timestamps and stable ids', () => {
    expect(wandererTime(Date.UTC(2025, 0, 1, 13, 38, 42, 875))).toBe('2025-01-01T13:38:42.875000Z');
    expect(stableUuid('system', 'm', 1)).toBe(stableUuid('system', 'm', 1));
    expect(stableUuid('system', 'm', 1)).not.toBe(stableUuid('system', 'm', 2));
    expect(stableUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('describes removals from what the stream saw before', () => {
    const connection = {
      id: 'c1',
      source: 1,
      target: 2,
      type: 'wormhole',
      massStatus: 'critical',
      timeStatus: 'eol',
      shipSize: 'medium',
    } as ConnectionDto;
    const state = new WandererStreamState({ connections: [connection] });
    expect(wandererEvent(event('connection.removed', { id: 'c1' }), ctx, state)).toMatchObject({
      type: 'connection_removed',
      payload: { connection_id: 'c1', solar_system_source_id: 1, solar_system_target_id: 2 },
    });
    expect(wandererEvent(event('connection.updated', connection), ctx, state)).toMatchObject({
      type: 'connection_updated',
      timestamp: '2026-10-12T12:00:00.875000Z',
      payload: {
        mass_status: 2,
        time_status: 1,
        ship_size_type: 1,
        type: 0,
        locked: false,
        custom_info: null,
      },
    });
    expect(wandererEvent(event('routes.exits_changed', { exits: [] }), ctx, state)).toBeNull();
    expect(
      wandererEvent(
        event('access.rule_added', { id: 'r', subjectKind: 'corporation', subjectId: '98', role: 'blocked' }),
        ctx,
        state,
      ),
    ).toMatchObject({
      type: 'acl_member_added',
      payload: { acl_id: 'm', member_type: 'corporation', eve_id: '98', role: 'blocked' },
    });
    // Discord roles and accounts are not Wanderer ACL members.
    expect(
      wandererEvent(
        event('access.rule_added', { id: 'r', subjectKind: 'account', subjectId: 'a' }),
        ctx,
        state,
      ),
    ).toBeNull();
  });
});
