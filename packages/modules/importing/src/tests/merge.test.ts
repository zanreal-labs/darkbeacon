import type { ConnectionDto, MapSystemDto, SignatureDto } from '@darkbeacon/shared';
import { describe, expect, it } from 'vitest';
import { apiDump, SYS, systemName } from '../test-support.js';
import { decideAccess, decideConnection, decideSignature, decideSystem } from '../domain/decide.js';
import { mergeFields } from '../domain/merge.js';
import { translate } from '../domain/translate.js';

interface Note {
  name: string | null;
  notes: string;
  tags: string[];
}

const merge = (
  input: Partial<Parameters<typeof mergeFields<Note>>[0]> &
    Pick<Parameters<typeof mergeFields<Note>>[0], 'here' | 'wanderer'>,
) =>
  mergeFields<Note>({
    base: null,
    hereAt: 100,
    wandererAt: 200,
    fields: ['name', 'notes', 'tags'],
    joined: ['notes', 'tags'],
    ...input,
  });

describe('merging field by field', () => {
  it('fills blanks here and ignores blanks in Wanderer on a first import', () => {
    const { patch, conflicts } = merge({
      here: { name: null, notes: 'mine', tags: [] },
      wanderer: { name: 'theirs', notes: '', tags: ['a'] },
    });
    expect(patch).toEqual({ name: 'theirs', tags: ['a'] });
    expect(conflicts).toEqual([]);
  });

  it('lets the newer side win where both have a value', () => {
    expect(
      merge({ here: { name: 'old', notes: '', tags: [] }, wanderer: { name: 'new', notes: '', tags: [] } })
        .patch,
    ).toEqual({
      name: 'new',
    });
    const kept = merge({
      here: { name: 'mine', notes: '', tags: [] },
      wanderer: { name: 'theirs', notes: '', tags: [] },
      hereAt: 300,
    });
    expect(kept.patch).toEqual({});
    expect(kept.conflicts).toEqual([
      expect.objectContaining({ field: 'name', keeps: 'here', why: 'Changed later here' }),
    ]);
    // Without a time from Wanderer the map keeps its value.
    expect(
      merge({
        here: { name: 'mine', notes: '', tags: [] },
        wanderer: { name: 'theirs', notes: '', tags: [] },
        wandererAt: null,
      }).patch,
    ).toEqual({});
  });

  it('never loses notes or labels: different ones are joined', () => {
    const { patch, conflicts } = merge({
      here: { name: null, notes: 'Ours', tags: ['a'] },
      wanderer: { name: null, notes: 'Theirs', tags: ['b'] },
      hereAt: 999,
    });
    expect(patch).toEqual({ notes: 'Ours\n\nTheirs', tags: ['a', 'b'] });
    expect(conflicts.map((c) => c.keeps)).toEqual(['wanderer', 'wanderer']);
    // Already in there: nothing to do.
    expect(
      merge({
        here: { name: null, notes: 'Ours\n\nTheirs', tags: [] },
        wanderer: { name: null, notes: 'Theirs', tags: [] },
      }).patch,
    ).toEqual({});
  });

  it('is a three-way merge against what the last import wrote', () => {
    const base: Note = { name: 'A', notes: 'Imported', tags: ['a'] };
    // Only Wanderer changed: taken. Only here changed: kept.
    expect(
      merge({ base, here: { ...base, name: 'Mine' }, wanderer: { ...base, notes: 'Imported, then edited' } })
        .patch,
    ).toEqual({
      notes: 'Imported, then edited',
    });
    // Nobody changed: nothing.
    expect(merge({ base, here: base, wanderer: base }).patch).toEqual({});
    // Both changed the notes: Wanderer's new text replaces what the import wrote, in place.
    expect(
      merge({
        base,
        here: { ...base, notes: 'Imported\nplus mine' },
        wanderer: { ...base, notes: 'Updated' },
      }).patch,
    ).toEqual({ notes: 'Updated\nplus mine' });
  });

  it('protects fields with a reason', () => {
    const { patch, conflicts } = merge({
      here: { name: 'Here', notes: '', tags: [] },
      wanderer: { name: 'There', notes: '', tags: [] },
      protect: { name: 'The system is locked here' },
    });
    expect(patch).toEqual({});
    expect(conflicts[0]).toMatchObject({ keeps: 'here', why: 'The system is locked here' });
  });
});

describe('import decisions', () => {
  const { plan } = translate(apiDump(), { systemName, layoutScale: 1 });
  const planned = plan.systems.find((s) => s.solarSystemId === SYS.home)!;
  const labelIds = new Map(plan.labels.map((l) => [l.key, `id-${l.name}`]));
  const here: MapSystemDto = {
    mapId: 'm',
    solarSystemId: SYS.home,
    position: { x: 500, y: 500 },
    customName: null,
    temporaryName: null,
    tag: 'HOME',
    status: 'unknown',
    description: 'Our notes',
    labelIds: ['id-Other'],
    locked: true,
    visible: true,
    createdAt: 1,
    updatedAt: Date.parse('2026-10-12T10:00:00Z'),
  };

  it('creates a system as Wanderer has it', () => {
    const decision = decideSystem(planned, undefined, null, labelIds, { removeMissing: false });
    expect(decision.action).toBe('create');
    expect(decision.write).toMatchObject({
      status: 'home',
      customName: 'Home sweet home',
      labelIds: ['id-Label A', 'id-Label 1', 'id-Staging'],
    });
  });

  it('merges into a system here: blanks filled, locks respected, notes and labels joined', () => {
    const decision = decideSystem(planned, here, null, labelIds, { removeMissing: false });
    expect(decision.action).toBe('update');
    expect(decision.write.customName).toBe('Home sweet home');
    expect(decision.write.status).toBe('home');
    expect(decision.write.position).toBeUndefined();
    expect(decision.write.tag).toBeUndefined(); // both have one; the map changed later
    expect(decision.write.description?.startsWith('Our notes\n\nOur home.')).toBe(true);
    expect(decision.write.labelIds).toEqual(['id-Other', 'id-Label A', 'id-Label 1', 'id-Staging']);
    expect(decision.conflicts.find((c) => c.field === 'position')?.why).toBe('The system is locked here');
  });

  it('hides a system Wanderer took off its map only when removals are asked for', () => {
    const hidden = { ...planned, fields: { ...planned.fields, visible: false } };
    const shown = { ...here, locked: false };
    expect(
      decideSystem(hidden, shown, null, labelIds, { removeMissing: false }).write.visible,
    ).toBeUndefined();
    const base = decideSystem(planned, undefined, null, labelIds, { removeMissing: false }).written;
    expect(
      decideSystem(hidden, { ...shown, ...base, updatedAt: 0 }, base, labelIds, { removeMissing: true }).write
        .visible,
    ).toBe(false);
  });

  it('marks a connection end of life from Wanderer but never clears a mark made here', () => {
    const eol = plan.connections.find((c) => c.fields.timeStatus === 'eol')!;
    const fresh: ConnectionDto = {
      id: 'c',
      mapId: 'm',
      source: eol.source,
      target: eol.target,
      type: 'wormhole',
      timeStatus: 'normal',
      massStatus: 'fresh',
      shipSize: 'large',
      massSaved: false,
      dangerous: false,
      bubbled: 'none',
      eolAt: null,
      massStatusAt: null,
      createdAt: 1,
      updatedAt: Date.parse('2026-10-12T12:00:00Z'),
    };
    const decision = decideConnection(eol, fresh, null);
    expect(decision.write).toMatchObject({ timeStatus: 'eol', eolAt: eol.fields.eolAt });
    const normal = { ...eol, fields: { ...eol.fields, timeStatus: 'normal' as const, eolAt: null } };
    expect(
      decideConnection(normal, { ...fresh, timeStatus: 'eol', eolAt: 5 }, null).write.timeStatus,
    ).toBeUndefined();
  });

  it('keeps a link made here and joins signature notes', () => {
    const sig = plan.signatures.find((s) => s.eveId === 'DEF-456')!;
    const mine: SignatureDto = {
      id: 's',
      mapId: 'm',
      solarSystemId: SYS.home,
      eveId: 'DEF-456',
      group: 'unknown',
      type: null,
      name: null,
      description: 'Ran it',
      connectionId: 'c-here',
      createdAt: 1,
      updatedAt: 2,
    };
    const decision = decideSignature(sig, mine, null, null);
    expect(decision.write).toEqual({
      group: 'relic',
      name: 'Forgotten Perimeter Coronation Platform',
      description: 'Ran it\n\nHacked half',
    });
  });

  it('adds missing access rules, follows rules it added, keeps the map own ones', () => {
    const rule = plan.access.find((r) => r.key === 'character:2112625428')!;
    expect(decideAccess(rule, undefined, null).action).toBe('create');
    const existing = {
      id: 'r1',
      mapId: 'm',
      subjectKind: 'character' as const,
      subjectId: '2112625428',
      guildId: null,
      role: 'member' as const,
      createdAt: 1,
    };
    expect(decideAccess(rule, existing, null)).toMatchObject({
      action: 'unchanged',
      conflict: { keeps: 'here' },
    });
    expect(decideAccess(rule, existing, { role: 'member', ruleId: 'r1' }).action).toBe('replace');
    expect(decideAccess(rule, { ...existing, role: 'admin' }, null).action).toBe('unchanged');
  });
});
