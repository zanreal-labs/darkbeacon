import { describe, expect, it } from 'vitest';
import type { StoredEvent } from './entries.js';
import type { AuditRecord } from './record.js';
import { undoPlan } from './undo.js';

let seq = 0;
function stored(
  type: string,
  entity: { kind: string; id: string },
  data: Record<string, unknown> = {},
  diff: AuditRecord['diff'] = {},
): StoredEvent {
  seq += 1;
  return {
    event: {
      id: `e${seq}`,
      seq,
      stream: 'map:m',
      type,
      occurredAt: 1000,
      actor: { kind: 'account', id: 'a' },
      data,
      v: 1,
    },
    audit: {
      actor: {
        kind: 'account',
        id: 'a',
        accountId: 'a',
        accountName: null,
        characterId: null,
        characterName: null,
      },
      channel: { kind: 'web', id: null },
      origin: null,
      op: 'update',
      entity,
      diff,
      removed: null,
      revertOf: null,
    },
  };
}

const types = (plan: StoredEvent[]) => plan.map((s) => `${s.event.type} ${s.audit!.entity!.id}`);

describe('undoPlan', () => {
  it('puts a removed system back before its connections and their signatures', () => {
    const unlink = stored(
      'signature.updated',
      { kind: 'signature', id: 's1' },
      {},
      {
        connectionId: { before: 'c1', after: null },
      },
    );
    const conn = stored('connection.removed', { kind: 'connection', id: 'c1' });
    const sys = stored('system.removed', { kind: 'system', id: '1' });
    const renumber = stored(
      'connection.updated',
      { kind: 'connection', id: 'c2' },
      {},
      {
        bookmarkNumber: { before: 2, after: 1 },
      },
    );
    expect(types(undoPlan([unlink, conn, sys, renumber]))).toEqual([
      'system.removed 1',
      'connection.removed c1',
      'signature.updated s1',
    ]);
  });

  it('leaves what an undone add takes away anyway', () => {
    const added = stored('system.added', { kind: 'system', id: '7' });
    const restoredSig = stored('signature.added', { kind: 'signature', id: 's9' }, { solarSystemId: 7 });
    const changed = stored(
      'system.updated',
      { kind: 'system', id: '7' },
      {},
      { tag: { before: null, after: 'A' } },
    );
    const other = stored(
      'system.updated',
      { kind: 'system', id: '8' },
      {},
      { tag: { before: null, after: 'B' } },
    );
    expect(types(undoPlan([added, restoredSig, changed, other]))).toEqual([
      'system.updated 8',
      'system.added 7',
    ]);
  });

  it('undoes a lone renumbering, newest change first otherwise', () => {
    const renumber = stored(
      'connection.updated',
      { kind: 'connection', id: 'c2' },
      {},
      {
        bookmarkNumber: { before: 2, after: 1 },
      },
    );
    expect(types(undoPlan([renumber]))).toEqual(['connection.updated c2']);
    const first = stored('system.updated', { kind: 'system', id: '1' });
    const second = stored('system.updated', { kind: 'system', id: '2' });
    expect(types(undoPlan([first, second]))).toEqual(['system.updated 2', 'system.updated 1']);
  });
});
