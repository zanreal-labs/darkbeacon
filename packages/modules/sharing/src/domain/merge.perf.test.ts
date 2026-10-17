import { describe, expect, it } from 'vitest';
import type { ChainEntry, StampedValue } from '@darkbeacon/shared';
import { pairKey, refId, signatureKey } from './keys.js';
import { ChainMerge } from './merge.js';
import { entitiesOf, ViewState, type SourceInfo, type ViewContext, type ViewEntity } from './view.js';

const SOURCES = 20;
const SYSTEMS_PER_SOURCE = 300;
/** Systems are drawn from a shared pool, so neighbouring corps overlap by half. */
const POOL = SOURCES * (SYSTEMS_PER_SOURCE / 2) + SYSTEMS_PER_SOURCE / 2;
const s = (v: unknown, at: number): StampedValue => ({ v, at });

function sourceChain(index: number): ChainEntry[] {
  const first = index * (SYSTEMS_PER_SOURCE / 2);
  const ids = Array.from({ length: SYSTEMS_PER_SOURCE }, (_, i) => 31000000 + ((first + i) % POOL));
  const entries: ChainEntry[] = [];
  ids.forEach((id, i) => {
    entries.push({
      kind: 'system',
      key: String(id),
      state: 'present',
      born: 1,
      fields: {
        pos: s({ x: i * 360, y: index * 150 }, 1 + index),
        status: s('unknown', 1 + index),
        tag: s(null, 1),
      },
    });
    if (i > 0) {
      entries.push({
        kind: 'connection',
        key: pairKey(ids[i - 1]!, id),
        state: 'present',
        born: 1,
        // Corps disagree about mass: the later one wins.
        fields: {
          kind: s('wormhole', 1),
          mass: s({ status: index % 2 ? 'reduced' : 'fresh', at: 1 }, 1 + index),
        },
      });
    }
    for (let n = 0; n < 3; n++) {
      entries.push({
        kind: 'signature',
        key: signatureKey(id, `ABC-${String(n).padStart(3, '0')}`),
        state: 'present',
        born: 1,
        fields: { group: s('wormhole', 1 + index), name: s(null, 1), link: s(null, 1) },
      });
    }
  });
  return entries;
}

describe('merge performance', () => {
  it(`merges ${SOURCES} sources × ${SYSTEMS_PER_SOURCE} systems and then follows single edits incrementally`, () => {
    const chains = Array.from({ length: SOURCES }, (_, i) => sourceChain(i));
    const sources = new Map<string, SourceInfo>(
      chains.map((_, i) => [
        `s${i}`,
        {
          id: `s${i}`,
          origin: { instance: 'local', mapId: `s${i}` },
          name: `Corp ${i}`,
          instanceName: null,
          level: 'read-write',
          scopes: ['topology', 'connectionStatus', 'signatures'],
          hidden: false,
        },
      ]),
    );
    const ctx: ViewContext = { mapId: 'alliance', sources, layout: new Map() };

    const started = performance.now();
    const merge = new ChainMerge();
    chains.forEach((entries, i) => {
      merge.setSource(`s${i}`, i);
      merge.apply(`s${i}`, entries, true);
    });
    const refs = [...merge.refs()];
    const next: ViewEntity[] = refs.flatMap((ref) => entitiesOf(merge, ref, ctx));
    const view = new ViewState();
    view.apply(view.diff(refs, next));
    const full = performance.now() - started;

    const systems = next.filter((e) => e.kind === 'system').length;
    expect(systems).toBe(POOL);
    // One node per system, one edge per pair, however many corps hold them.
    expect(new Set(next.filter((e) => e.kind === 'connection').map((e) => e.id)).size).toBe(
      next.filter((e) => e.kind === 'connection').length,
    );

    // A single edit: one corp marks one hole critical.
    const edits = 500;
    const editStarted = performance.now();
    for (let n = 0; n < edits; n++) {
      const source = n % SOURCES;
      const entries = chains[source]!;
      const edge = entries.filter((e) => e.kind === 'connection')[n % 100]!;
      const touched = merge.apply(`s${source}`, [
        {
          ...edge,
          fields: {
            ...(edge as Extract<ChainEntry, { state: 'present' }>).fields,
            mass: s({ status: 'critical', at: 1000 + n }, 1000 + n),
          },
        } as ChainEntry,
      ]);
      const changes = view.diff(
        touched,
        [...touched].flatMap((ref) => entitiesOf(merge, ref, ctx)),
      );
      expect(changes.length).toBeLessThanOrEqual(1);
      view.apply(changes);
    }
    const perEdit = (performance.now() - editStarted) / edits;

    // Revoking one share: its objects go at once (those other corps hold stay).
    const revokeStarted = performance.now();
    const touched = merge.removeSource('s7');
    const revokeChanges = view.diff(
      touched,
      [...touched].flatMap((ref) => entitiesOf(merge, ref, ctx)),
    );
    view.apply(revokeChanges);
    const revoke = performance.now() - revokeStarted;
    expect(revokeChanges.some((c) => c.after === null)).toBe(true);
    expect(merge.objects(refId('system', String(31000000 + 7 * 150 + 1)))[0]?.holders).toEqual(['s6']);

    console.info(
      `merge perf: ${SOURCES}×${SYSTEMS_PER_SOURCE} systems (${systems} distinct, ${next.length} entities) built in ${full.toFixed(0)} ms; ` +
        `one edit ${perEdit.toFixed(3)} ms; revoking one source ${revoke.toFixed(1)} ms`,
    );
    expect(full).toBeLessThan(5_000);
    expect(perEdit).toBeLessThan(5);
  });

  it('keeps an intel library of thousands of hidden systems without showing or slowing anything', () => {
    const LIBRARY = 6000;
    const chains = Array.from({ length: SOURCES }, (_, i) => sourceChain(i));
    // The library hides every system of the pool (so they get its notes) and thousands more.
    const library: ChainEntry[] = [];
    for (let i = 0; i < LIBRARY; i++) {
      const id = 31000000 + i;
      library.push({
        kind: 'system',
        key: String(id),
        state: 'present',
        hidden: true,
        born: 1,
        fields: { notes: s(`intel ${id}`, 50), status: s('hostile', 50) },
      });
      for (let n = 0; n < 2; n++) {
        library.push({
          kind: 'signature',
          key: signatureKey(id, `LIB-${String(n).padStart(3, '0')}`),
          state: 'present',
          hidden: true,
          born: 1,
          fields: { group: s('relic', 50) },
        });
      }
    }
    const sources = new Map<string, SourceInfo>(
      [...chains.map((_, i) => `s${i}`), 'library'].map((id) => [
        id,
        {
          id,
          origin: { instance: 'local', mapId: id },
          name: id,
          instanceName: null,
          level: 'read',
          scopes: ['topology', 'signatures', 'intel'],
          hidden: false,
        },
      ]),
    );
    const ctx: ViewContext = { mapId: 'alliance', sources, layout: new Map() };

    const started = performance.now();
    const merge = new ChainMerge();
    chains.forEach((entries, i) => {
      merge.setSource(`s${i}`, i);
      merge.apply(`s${i}`, entries, true);
    });
    merge.setSource('library', SOURCES);
    merge.apply('library', library, true);
    const refs = [...merge.refs()];
    const next: ViewEntity[] = refs.flatMap((ref) => entitiesOf(merge, ref, ctx));
    const view = new ViewState();
    view.apply(view.diff(refs, next));
    const full = performance.now() - started;

    const systems = next.filter((e) => e.kind === 'system');
    // Only the shown systems, each with the library's intel; its own systems stay hidden.
    expect(systems).toHaveLength(POOL);
    expect(systems.every((e) => e.kind === 'system' && e.dto.description.startsWith('intel '))).toBe(true);
    expect(next.filter((e) => e.kind === 'signature')).toHaveLength(POOL * 5);

    // A sync's pull re-reads the library: one changed note costs as little as any edit.
    const edits = 200;
    const editStarted = performance.now();
    for (let n = 0; n < edits; n++) {
      const id = 31000000 + ((n * 37) % LIBRARY);
      const touched = merge.apply('library', [
        {
          kind: 'system',
          key: String(id),
          state: 'present',
          hidden: true,
          born: 1,
          fields: { notes: s(`intel ${id} v${n}`, 100 + n), status: s('hostile', 50) },
        },
      ]);
      const changes = view.diff(
        touched,
        [...touched].flatMap((ref) => entitiesOf(merge, ref, ctx)),
      );
      expect(changes.length).toBeLessThanOrEqual(1);
      view.apply(changes);
    }
    const perEdit = (performance.now() - editStarted) / edits;
    // One system's signatures, as a feed signal asks for them, from the index.
    const heldStarted = performance.now();
    for (let n = 0; n < edits; n++) merge.held('library', 'signature', 31000000 + n);
    const perHeld = (performance.now() - heldStarted) / edits;

    console.info(
      `merge perf: ${SOURCES}×${SYSTEMS_PER_SOURCE} systems and a library of ${LIBRARY} hidden ones built in ${full.toFixed(0)} ms; ` +
        `one library edit ${perEdit.toFixed(3)} ms; one system's held signatures ${perHeld.toFixed(3)} ms`,
    );
    expect(full).toBeLessThan(5_000);
    expect(perEdit).toBeLessThan(5);
    expect(perHeld).toBeLessThan(1);
  });
});
