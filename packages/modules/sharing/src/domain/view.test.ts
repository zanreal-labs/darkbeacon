import { describe, expect, it } from 'vitest';
import type { ChainEntry, StampedValue } from '@darkbeacon/shared';
import { refId } from './keys.js';
import { ChainMerge } from './merge.js';
import { entitiesOf, SELF, ViewState, type SourceInfo, type ViewContext } from './view.js';

const J1 = 31000001;
const J2 = 31000002;
const PAIR = `${J1}-${J2}`;
const s = (v: unknown, at: number): StampedValue => ({ v, at });
const present = (
  kind: ChainEntry['kind'],
  key: string,
  born: number,
  fields: Record<string, StampedValue> = {},
) => ({ kind, key, state: 'present', born, fields }) as ChainEntry;

const source = (id: string, level: SourceInfo['level']): SourceInfo => ({
  id,
  origin: { instance: 'local', mapId: id },
  name: id,
  instanceName: null,
  level,
  scopes: id === SELF ? 'all' : ['topology', 'connectionStatus', 'signatures'],
  hidden: false,
});

function setup() {
  const merge = new ChainMerge();
  merge.setSource('ro', 0);
  merge.setSource('rw', 1);
  const ctx: ViewContext = {
    mapId: 'alliance',
    sources: new Map([
      ['ro', source('ro', 'read')],
      ['rw', source('rw', 'read-write')],
    ]),
    layout: new Map([[J1, { x: 10, y: 20 }]]),
  };
  return { merge, ctx };
}

describe('merged view', () => {
  it('shows merged Labels as the map’s own of the same name, and the custom label as it is', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [
      present('system', String(J1), 1, { systemLabels: s(['wh2', 'B'], 2), customLabel: s('bait', 2) }),
    ]);
    const own = { ...ctx, systemLabels: [{ id: 'mine-2', name: 'WH2' }] };
    const [j1] = entitiesOf(merge, refId('system', String(J1)), own);
    expect(j1!.dto).toMatchObject({ systemLabelIds: ['mine-2'], customLabel: 'bait' });
    // A map without Labels shows none; the custom label still shows.
    const [bare] = entitiesOf(merge, refId('system', String(J1)), ctx);
    expect(bare!.dto).toMatchObject({ systemLabelIds: [], customLabel: 'bait' });
  });

  it('builds systems with the map’s own layout, the merged fields and provenance', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [
      present('system', String(J1), 1, { pos: s({ x: 500, y: 0 }, 1), status: s('hostile', 7) }),
    ]);
    merge.apply('rw', [present('system', String(J2), 3, { pos: s({ x: 360, y: 150 }, 3) })]);
    const [j1] = entitiesOf(merge, refId('system', String(J1)), ctx);
    expect(j1!.dto).toMatchObject({
      mapId: 'alliance',
      solarSystemId: J1,
      position: { x: 10, y: 20 },
      status: 'hostile',
      visible: true,
      provenance: { sources: ['ro'], updatedBy: 'ro', updatedAt: 7, writable: false },
    });
    const [j2] = entitiesOf(merge, refId('system', String(J2)), ctx);
    // No layout yet: the source's position is the hint.
    expect(j2!.dto).toMatchObject({
      position: { x: 360, y: 150 },
      status: 'unknown',
      provenance: { writable: true },
    });
  });

  it('shows a lock held by any source, says where, and never takes one source’s lock for another’s', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [present('system', String(J1), 1, { locked: s(true, 2) })]);
    // A newer "unlocked" from another source must not hide the first one's lock.
    merge.apply('rw', [present('system', String(J1), 1, { locked: s(false, 9) })]);
    const named = {
      ...ctx,
      sources: new Map([...ctx.sources].map(([id, v]) => [id, { ...v, name: `Map ${id}` }])),
    };
    const [j1] = entitiesOf(merge, refId('system', String(J1)), named);
    expect(j1!.dto).toMatchObject({
      locked: true,
      lockedBy: 'source',
      lockedOn: [{ sourceId: 'ro', name: 'Map ro' }],
    });

    // A composite's own lock wins the label; the sources holding one stay listed.
    const local = new Map([[J1, { notes: null, labelIds: [], locked: true }]]);
    const [own] = entitiesOf(merge, refId('system', String(J1)), { ...named, local });
    expect(own!.dto).toMatchObject({ locked: true, lockedBy: 'here', lockedOn: [{ sourceId: 'ro' }] });

    // Unlocked everywhere: no lock fields at all.
    merge.apply('ro', [present('system', String(J1), 1, { locked: s(false, 10) })]);
    const [open] = entitiesOf(merge, refId('system', String(J1)), named);
    expect(open!.dto).toMatchObject({ locked: false });
    expect(open!.dto).not.toHaveProperty('lockedBy');
    expect(open!.dto).not.toHaveProperty('lockedOn');
  });

  it('shows a map’s own lock as held here, apart from what shares say', () => {
    const merge = new ChainMerge();
    merge.setSource(SELF, 0);
    merge.setSource('rw', 1);
    merge.apply(SELF, [
      present('system', String(J1), 1, { locked: s(true, 1) }),
      present('system', String(J2), 1),
      present('connection', PAIR, 1, { locked: s(false, 1) }),
    ]);
    merge.apply('rw', [
      present('system', String(J1), 1, { locked: s(false, 5) }),
      present('connection', PAIR, 1, { locked: s(true, 5) }),
    ]);
    const ctx: ViewContext = {
      mapId: 'mine',
      sources: new Map([
        [SELF, source(SELF, 'read-write')],
        ['rw', source('rw', 'read-write')],
      ]),
      layout: new Map(),
    };
    const [j1] = entitiesOf(merge, refId('system', String(J1)), ctx);
    expect(j1!.dto).toMatchObject({ locked: true, lockedBy: 'here' });
    expect(j1!.dto).not.toHaveProperty('lockedOn');
    const [edge] = entitiesOf(merge, refId('connection', PAIR), ctx);
    expect(edge!.dto).toMatchObject({ locked: true, lockedBy: 'source', lockedOn: [{ sourceId: 'rw' }] });
  });

  it('draws connections from the lower id and turns bubbled ends back into source/target', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [present('system', String(J1), 1), present('system', String(J2), 1)]);
    merge.apply('ro', [
      present('connection', PAIR, 1, { bubbled: s('high', 2), mass: s({ status: 'critical', at: 2 }, 2) }),
    ]);
    const [edge] = entitiesOf(merge, refId('connection', PAIR), ctx);
    expect(edge!.dto).toMatchObject({
      id: `c:${PAIR}`,
      source: J1,
      target: J2,
      bubbled: 'target',
      massStatus: 'critical',
      massStatusAt: 2,
      timeStatus: 'normal',
    });
  });

  it('shows connections and signatures only while their systems are shown', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [present('system', String(J1), 1), present('connection', PAIR, 1)]);
    expect(entitiesOf(merge, refId('connection', PAIR), ctx)).toEqual([]);
    merge.apply('ro', [present('signature', `${J2}:ABC-123`, 1)]);
    expect(entitiesOf(merge, refId('signature', `${J2}:ABC-123`), ctx)).toEqual([]);
  });

  it('links signatures to the merged hole of their type', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [
      present('system', String(J1), 1),
      present('system', String(J2), 1),
      present('connection', PAIR, 1, { whType: s('H296', 1) }),
    ]);
    merge.apply('rw', [
      present('connection', PAIR, 2, { whType: s('B274', 2) }),
      present('signature', `${J1}:ABC-123`, 2, { type: s('B274', 2), link: s(PAIR, 2) }),
    ]);
    const [sig] = entitiesOf(merge, refId('signature', `${J1}:ABC-123`), ctx);
    expect(sig!.dto).toMatchObject({
      id: `s:${J1}:ABC-123`,
      connectionId: `c:${PAIR}:B274`,
      eveId: 'ABC-123',
    });
  });

  it('diffs what viewers have against the new view, removals first', () => {
    const { merge, ctx } = setup();
    merge.apply('ro', [
      present('system', String(J1), 1),
      present('system', String(J2), 1),
      present('connection', PAIR, 1),
    ]);
    const refs = [...merge.refs()];
    const view = new ViewState();
    const first = view.diff(
      refs,
      refs.flatMap((r) => entitiesOf(merge, r, ctx)),
    );
    expect(first.map((c) => [c.before?.kind ?? null, c.after?.kind ?? null])).toEqual([
      [null, 'system'],
      [null, 'system'],
      [null, 'connection'],
    ]);
    view.apply(first);
    expect(
      view.diff(
        refs,
        refs.flatMap((r) => entitiesOf(merge, r, ctx)),
      ),
    ).toEqual([]);

    const touched = merge.removeSource('ro');
    const next = [...touched].flatMap((r) => entitiesOf(merge, r, ctx));
    const second = view.diff(touched, next);
    expect(second.map((c) => [c.before?.kind, c.after])).toEqual([
      ['connection', null],
      ['system', null],
      ['system', null],
    ]);
    view.apply(second);
    expect(view.size).toBe(0);
  });
});
