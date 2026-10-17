import { describe, expect, it } from 'vitest';
import type { ChainEntry, StampedValue } from '@darkbeacon/shared';
import { refId } from './keys.js';
import { ChainMerge } from './merge.js';

const J1 = 31000001;
const J2 = 31000002;
const J3 = 31000003;

const s = (v: unknown, at: number): StampedValue => ({ v, at });

function system(id: number, born: number, fields: Record<string, StampedValue> = {}): ChainEntry {
  return { kind: 'system', key: String(id), state: 'present', born, fields };
}
function connection(key: string, born: number, fields: Record<string, StampedValue> = {}): ChainEntry {
  return { kind: 'connection', key, state: 'present', born, fields };
}
function signature(key: string, born: number, fields: Record<string, StampedValue> = {}): ChainEntry {
  return { kind: 'signature', key, state: 'present', born, fields };
}

function twoSources() {
  const merge = new ChainMerge();
  merge.setSource('a', 0);
  merge.setSource('b', 1);
  return merge;
}

const PAIR = `${J1}-${J2}`;

describe('ChainMerge', () => {
  it('keeps one object per system, whichever sources hold it', () => {
    const merge = twoSources();
    merge.apply('a', [system(J1, 1), system(J2, 1)], true);
    merge.apply('b', [system(J2, 5), system(J3, 5)], true);
    expect([...merge.refs()].sort()).toEqual([`system|${J1}`, `system|${J2}`, `system|${J3}`]);
    const [j2] = merge.objects(refId('system', String(J2)));
    expect(j2).toMatchObject({ holders: ['a', 'b'], born: 1 });
  });

  it('merges every field last-writer-wins by its own time', () => {
    const merge = twoSources();
    merge.apply('a', [
      connection(PAIR, 1, { mass: s({ status: 'critical' }, 50), time: s({ status: 'normal' }, 10) }),
    ]);
    merge.apply('b', [
      connection(PAIR, 2, { mass: s({ status: 'reduced' }, 40), time: s({ status: 'eol' }, 60) }),
    ]);
    const [merged] = merge.objects(refId('connection', PAIR));
    expect(merged!.fields).toEqual({ mass: { status: 'critical' }, time: { status: 'eol' } });
    expect(merged!.fieldSources).toEqual({ mass: 'a', time: 'b' });
    expect(merged).toMatchObject({ updatedBy: 'b', updatedAt: 60, holders: ['a', 'b'] });
  });

  it('gives a tie to the earlier source', () => {
    const merge = twoSources();
    merge.apply('b', [system(J1, 1, { status: s('hostile', 10) })]);
    merge.apply('a', [system(J1, 1, { status: s('friendly', 10) })]);
    expect(merge.objects(refId('system', String(J1)))[0]!.fields.status).toBe('friendly');
  });

  it('follows edits from several sources over time', () => {
    const merge = twoSources();
    const ref = refId('system', String(J1));
    merge.apply('a', [system(J1, 1, { status: s('home', 1), tag: s('A', 1) })]);
    merge.apply('b', [system(J1, 2, { status: s('unknown', 2), tag: s(null, 2) })]);
    expect(merge.objects(ref)[0]!.fields).toEqual({ status: 'unknown', tag: null });
    merge.apply('a', [system(J1, 1, { status: s('hostile', 9), tag: s('A', 1) })]);
    expect(merge.objects(ref)[0]!.fields).toEqual({ status: 'hostile', tag: null });
    merge.apply('b', [system(J1, 2, { status: s('unknown', 2), tag: s('B2', 12) })]);
    expect(merge.objects(ref)[0]!.fields).toEqual({ status: 'hostile', tag: 'B2' });
  });

  it('keeps a deleted signature deleted against older copies, and lets a newer one bring it back', () => {
    const merge = twoSources();
    const key = `${J1}:ABC-123`;
    const ref = refId('signature', key);
    merge.apply('a', [signature(key, 1, { group: s('wormhole', 5) })]);
    merge.apply('b', [signature(key, 2, { name: s('Unstable', 6) })]);
    expect(merge.objects(ref)).toHaveLength(1);

    merge.apply('b', [{ kind: 'signature', key, state: 'deleted', at: 20 }]);
    // a's copy last changed at 5, before the deletion: it stays gone.
    expect(merge.objects(ref)).toEqual([]);
    expect(merge.holders(ref)).toEqual([]);

    // Re-reading a's old copy changes nothing.
    merge.apply('a', [signature(key, 1, { group: s('wormhole', 5) })]);
    expect(merge.objects(ref)).toEqual([]);

    // A change after the deletion is a new sighting.
    merge.apply('a', [signature(key, 1, { group: s('combat', 25) })]);
    expect(merge.objects(ref)[0]).toMatchObject({ fields: { group: 'combat' }, holders: ['a'] });
  });

  it('treats absent as "does not hold it", not as a deletion', () => {
    const merge = twoSources();
    const key = `${J1}:ABC-123`;
    merge.apply('a', [signature(key, 1)]);
    merge.apply('b', [signature(key, 1)]);
    merge.apply('b', [{ kind: 'signature', key, state: 'absent' }]);
    expect(merge.holders(refId('signature', key))).toEqual(['a']);
  });

  it('drops what a source no longer has on a complete read', () => {
    const merge = twoSources();
    merge.apply('a', [system(J1, 1), system(J2, 1)], true);
    const touched = merge.apply('a', [system(J1, 1)], true);
    expect(touched.has(refId('system', String(J2)))).toBe(true);
    expect(merge.objects(refId('system', String(J2)))).toEqual([]);
  });

  it('removes a source at once (a revoked share) and reports what it touched', () => {
    const merge = twoSources();
    merge.apply('a', [system(J1, 1)]);
    merge.apply('b', [system(J1, 1), system(J2, 1), connection(PAIR, 1)]);
    const touched = merge.removeSource('b');
    expect([...touched].sort()).toEqual([`connection|${PAIR}`, `system|${J1}`, `system|${J2}`]);
    expect(merge.objects(refId('system', String(J2)))).toEqual([]);
    expect(merge.objects(refId('connection', PAIR))).toEqual([]);
    expect(merge.objects(refId('system', String(J1)))[0]!.holders).toEqual(['a']);
  });

  it('keys connections by pair, splitting holes that signatures type differently', () => {
    const merge = new ChainMerge();
    merge.setSource('a', 0);
    merge.setSource('b', 1);
    merge.setSource('c', 2);
    merge.apply('a', [connection(PAIR, 1, { whType: s('H296', 1) })]);
    merge.apply('b', [connection(PAIR, 3)]);
    // One known type: the untyped copy is the same hole.
    expect(merge.objects(refId('connection', PAIR)).map((o) => [o.key, o.holders])).toEqual([
      [PAIR, ['a', 'b']],
    ]);

    merge.apply('c', [connection(PAIR, 5, { whType: s('B274', 5) })]);
    // Two types: two holes; the oldest keeps the plain key (and so its id), the untyped copy joins it.
    expect(merge.objects(refId('connection', PAIR)).map((o) => [o.key, o.holders])).toEqual([
      [PAIR, ['a', 'b']],
      [`${PAIR}:B274`, ['c']],
    ]);
  });

  it('touches the signatures and connections that depend on a system or a hole', () => {
    const merge = twoSources();
    const sigKey = `${J1}:ABC-123`;
    merge.apply('a', [
      system(J1, 1),
      system(J2, 1),
      connection(PAIR, 1),
      signature(sigKey, 1, { link: s(PAIR, 1) }),
    ]);
    const bySystem = merge.apply('a', [system(J1, 1, { status: s('home', 3) })]);
    expect(bySystem.has(refId('connection', PAIR))).toBe(true);
    expect(bySystem.has(refId('signature', sigKey))).toBe(true);
    const byHole = merge.apply('a', [connection(PAIR, 1, { whType: s('H296', 4) })]);
    expect(byHole.has(refId('signature', sigKey))).toBe(true);
  });

  it('lists what one source holds, by kind and system', () => {
    const merge = twoSources();
    merge.apply('a', [
      connection(PAIR, 1),
      connection(`${J2}-${J3}`, 1),
      { kind: 'signature', key: `${J1}:ABC-123`, state: 'deleted', at: 4 },
    ]);
    expect(merge.held('a', 'connection').sort()).toEqual([`connection|${PAIR}`, `connection|${J2}-${J3}`]);
    expect(merge.held('a', 'connection', J1)).toEqual([`connection|${PAIR}`]);
    expect(merge.held('a', 'signature', J1)).toEqual([`signature|${J1}:ABC-123`]);
    expect(merge.held('b', 'connection')).toEqual([]);
  });

  describe('hidden copies (a source’s intel library)', () => {
    const hidden = (entry: ChainEntry): ChainEntry => ({ ...entry, hidden: true }) as ChainEntry;

    it('lend their fields to a system another source shows, per field, without holding it', () => {
      const merge = twoSources();
      merge.apply('a', [
        system(J1, 1, { status: s('unknown', 0), notes: s('', 0), pos: s({ x: 1, y: 1 }, 1) }),
      ]);
      merge.apply('b', [hidden(system(J1, 2, { status: s('hostile', 5), notes: s('Keepstar', 6) }))]);
      const [j1] = merge.objects(refId('system', String(J1)));
      expect(j1).toMatchObject({
        fields: { status: 'hostile', notes: 'Keepstar', pos: { x: 1, y: 1 } },
        fieldSources: { status: 'b', notes: 'b', pos: 'a' },
        holders: ['a'],
        keepers: ['b'],
        updatedBy: 'b',
      });
      expect(merge.holders(refId('system', String(J1)))).toEqual(['a']);
      // A newer value where it shows still wins.
      merge.apply('a', [system(J1, 1, { status: s('friendly', 9) })]);
      expect(merge.objects(refId('system', String(J1)))[0]!.fields).toMatchObject({
        status: 'friendly',
        notes: 'Keepstar',
      });
    });

    it('never make a system show on their own', () => {
      const merge = twoSources();
      merge.apply('b', [hidden(system(J1, 2, { notes: s('Keepstar', 6) }))]);
      expect(merge.objects(refId('system', String(J1)))).toEqual([]);
      expect(merge.shows(refId('system', String(J1)))).toBe(false);
      expect(merge.keepers(refId('system', String(J1)))).toEqual(['b']);
      // Shown somewhere, it is there with the kept intel; hidden there again, it goes.
      merge.apply('a', [system(J1, 1)]);
      expect(merge.objects(refId('system', String(J1)))[0]!.fields.notes).toBe('Keepstar');
      merge.apply('a', [hidden(system(J1, 1))]);
      expect(merge.shows(refId('system', String(J1)))).toBe(false);
    });

    it('keep the signatures of a hidden system, holding none of them for writes', () => {
      const merge = twoSources();
      const key = `${J1}:ABC-123`;
      merge.apply('b', [hidden(signature(key, 2, { group: s('relic', 2) }))]);
      const [sig] = merge.objects(refId('signature', key));
      expect(sig).toMatchObject({ fields: { group: 'relic' }, holders: [], keepers: ['b'] });
      expect(merge.held('b', 'signature', J1)).toEqual([refId('signature', key)]);
    });
  });
});
