import type { ChainEntry, ChainObjectKind, StampedValue } from '@darkbeacon/shared';
import { parsePair, parseRefId, parseSignatureKey, refId } from './keys.js';

/** One source's copy of an object: when it was created there, and its fields with their times. */
interface Copy {
  born: number;
  fields: Record<string, StampedValue>;
  /** The source keeps it without showing it (a hidden system, a signature in one): intel only. */
  hidden: boolean;
}

interface SourceState {
  order: number;
  copies: Map<string, Copy>;
  /** Deletions the source knows of, by ref id. */
  tombstones: Map<string, number>;
}

/** A merged object: per field the newest value among the live copies of all sources. */
export interface MergedObject {
  kind: ChainObjectKind;
  /** The object key; for connections the group key (`<pair>` or `<pair>:<type>`). */
  key: string;
  fields: Record<string, unknown>;
  /** The source each field's value came from. */
  fieldSources: Record<string, string>;
  /** The earliest creation among the live copies. */
  born: number;
  /** The newest change among the live copies, and the source that made it. */
  updatedAt: number;
  updatedBy: string;
  /** Sources showing a live copy, in source order: the ones a change goes to. */
  holders: string[];
  /** Sources keeping a live copy they do not show (their fields count, they take no writes). */
  keepers: string[];
}

/**
 * The merge of several sources' chains (framework-free, incremental). Every source is a set of
 * copies keyed by stable object keys; `apply` replaces copies and returns what it touched, and
 * `objects` merges one object on demand:
 *
 * - a copy is live unless some source deleted the object after the copy last changed (tombstones
 *   are compared by time, so an old copy never brings a deleted object back);
 * - each field is last-writer-wins by its own change time, ties going to the earlier source;
 * - a hidden copy (a source's intel library: a system it hides, the signatures in one) lends the
 *   object its fields but never makes it show: a system shows while some source shows it, and a
 *   hidden copy is no holder (changes go to the sources showing it);
 * - connections of one pair are one object, unless signatures name different wormhole types on
 *   them: then each type is its own hole and copies without a type join the oldest one.
 */
export class ChainMerge {
  private readonly sources = new Map<string, SourceState>();
  /** Every ref any source has a copy or tombstone of, per system it touches (for dependants). */
  private readonly bySystem = new Map<number, Set<string>>();
  /** Signature refs by the pair their copies link to. */
  private readonly links = new Map<string, Set<string>>();

  /** Adds a source (or moves it to `order`); a new source holds nothing yet. */
  setSource(id: string, order: number): void {
    const current = this.sources.get(id);
    if (current) current.order = order;
    else this.sources.set(id, { order, copies: new Map(), tombstones: new Map() });
  }

  hasSource(id: string): boolean {
    return this.sources.has(id);
  }

  sourceIds(): string[] {
    return [...this.sources.entries()].sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  }

  /** Drops a source and everything it held; returns the refs that may look different now. */
  removeSource(id: string): Set<string> {
    const source = this.sources.get(id);
    const touched = new Set<string>();
    if (!source) return touched;
    for (const ref of [...source.copies.keys(), ...source.tombstones.keys()]) touched.add(ref);
    this.sources.delete(id);
    return this.withDependants(touched);
  }

  /**
   * Applies entries of one source. `complete`: the entries are everything the source holds, so
   * anything else it held before is gone (absent, not deleted). Returns the touched refs, with
   * the connections and signatures that depend on them.
   */
  apply(sourceId: string, entries: readonly ChainEntry[], complete = false): Set<string> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    const touched = new Set<string>();
    const seen = new Set<string>();
    for (const entry of entries) {
      const ref = refId(entry.kind, entry.key);
      seen.add(ref);
      touched.add(ref);
      this.index(ref);
      if (entry.state === 'present') {
        source.copies.set(ref, { born: entry.born, fields: entry.fields, hidden: entry.hidden === true });
        source.tombstones.delete(ref);
        const link = entry.kind === 'signature' ? entry.fields.link?.v : undefined;
        if (typeof link === 'string') this.linkSet(link).add(ref);
      } else {
        source.copies.delete(ref);
        if (entry.state === 'deleted') source.tombstones.set(ref, entry.at);
        else source.tombstones.delete(ref);
      }
    }
    if (complete) {
      for (const ref of [...source.copies.keys(), ...source.tombstones.keys()]) {
        if (seen.has(ref)) continue;
        source.copies.delete(ref);
        source.tombstones.delete(ref);
        touched.add(ref);
      }
    }
    return this.withDependants(touched);
  }

  /** Refs this source holds a copy or tombstone of, of one kind (optionally in one system). */
  held(sourceId: string, kind: ChainObjectKind, solarSystemId?: number): string[] {
    const source = this.sources.get(sourceId);
    if (!source) return [];
    const out = new Set<string>();
    // In one system: from the index (a source may keep thousands of hidden systems).
    const candidates =
      solarSystemId !== undefined
        ? (this.bySystem.get(solarSystemId) ?? [])
        : [...source.copies.keys(), ...source.tombstones.keys()];
    for (const ref of candidates) {
      if (!source.copies.has(ref) && !source.tombstones.has(ref)) continue;
      if (parseRefId(ref).kind === kind) out.add(ref);
    }
    return [...out];
  }

  /** A field of one source's copy (positions: every map lays itself out, so they compare only within a source). */
  sourceField(sourceId: string, ref: string, field: string): unknown {
    return this.sources.get(sourceId)?.copies.get(ref)?.fields[field]?.v;
  }

  /** Systems linked to this one by a connection that is live somewhere. */
  neighbours(solarSystemId: number): number[] {
    const out = new Set<number>();
    for (const ref of this.bySystem.get(solarSystemId) ?? []) {
      const { kind, key } = parseRefId(ref);
      if (kind !== 'connection' || this.live(ref).length === 0) continue;
      for (const s of parsePair(key) ?? []) if (s !== solarSystemId) out.add(s);
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Sources showing a live copy of the ref, in source order (hidden copies are no holders). */
  holders(ref: string): string[] {
    return this.live(ref).flatMap((c) => (c.copy.hidden ? [] : [c.sourceId]));
  }

  /** Sources keeping a live hidden copy of the ref, in source order. */
  keepers(ref: string): string[] {
    return this.live(ref).flatMap((c) => (c.copy.hidden ? [c.sourceId] : []));
  }

  /** True when some source shows a live copy of the ref (cheap: nothing is merged). */
  shows(ref: string): boolean {
    return this.live(ref).some((c) => !c.copy.hidden);
  }

  /** Every ref any source holds a copy of. */
  refs(): Set<string> {
    const out = new Set<string>();
    for (const source of this.sources.values()) for (const ref of source.copies.keys()) out.add(ref);
    return out;
  }

  /** The merged object(s) of a ref: none when nothing live is left, several for distinct holes on one pair. */
  objects(ref: string): MergedObject[] {
    const { kind, key } = parseRefId(ref);
    const live = this.live(ref);
    if (live.length === 0) return [];
    // Hidden copies alone never make a system show; signatures follow their system (see view.ts).
    if (kind === 'system' && !live.some((c) => !c.copy.hidden)) return [];
    if (kind !== 'connection') return [mergeCopies(kind, key, live)];
    return groupHoles(live).map((group) =>
      mergeCopies(kind, group.key === null ? key : `${key}:${group.key}`, group.copies),
    );
  }

  private live(ref: string): LiveCopy[] {
    let deletedAt = -Infinity;
    for (const source of this.sources.values())
      deletedAt = Math.max(deletedAt, source.tombstones.get(ref) ?? -Infinity);
    const out: LiveCopy[] = [];
    for (const [sourceId, source] of this.sources) {
      const copy = source.copies.get(ref);
      if (copy && lastWrite(copy) > deletedAt) out.push({ sourceId, order: source.order, copy });
    }
    return out.sort((a, b) => a.order - b.order);
  }

  private index(ref: string): void {
    const { kind, key } = parseRefId(ref);
    for (const system of systemsOf(kind, key)) {
      let set = this.bySystem.get(system);
      if (!set) this.bySystem.set(system, (set = new Set()));
      set.add(ref);
    }
  }

  private linkSet(pair: string): Set<string> {
    let set = this.links.get(pair);
    if (!set) this.links.set(pair, (set = new Set()));
    return set;
  }

  /** A system decides whether its connections and signatures show; a connection's holes name its signatures' links. */
  private withDependants(touched: Set<string>): Set<string> {
    for (const ref of [...touched]) {
      const { kind, key } = parseRefId(ref);
      if (kind === 'system')
        for (const dependant of this.bySystem.get(Number(key)) ?? []) touched.add(dependant);
      if (kind === 'connection') for (const dependant of this.links.get(key) ?? []) touched.add(dependant);
    }
    return touched;
  }
}

interface LiveCopy {
  sourceId: string;
  order: number;
  copy: Copy;
}

/** The systems a key belongs to. */
function systemsOf(kind: ChainObjectKind, key: string): number[] {
  if (kind === 'system') return [Number(key)];
  if (kind === 'connection') return parsePair(key) ?? [];
  if (kind === 'signature') {
    const sig = parseSignatureKey(key);
    return sig ? [sig.solarSystemId] : [];
  }
  return [];
}

function lastWrite(copy: Copy): number {
  let at = copy.born;
  for (const value of Object.values(copy.fields)) at = Math.max(at, value.at);
  return at;
}

function mergeCopies(kind: ChainObjectKind, key: string, live: readonly LiveCopy[]): MergedObject {
  const fields: Record<string, unknown> = {};
  const fieldSources: Record<string, string> = {};
  const times: Record<string, number> = {};
  let born = Infinity;
  let updatedAt = -Infinity;
  let updatedBy = live[0]!.sourceId;
  for (const { sourceId, copy } of live) {
    born = Math.min(born, copy.born);
    if (copy.born > updatedAt) {
      updatedAt = copy.born;
      updatedBy = sourceId;
    }
    for (const [name, value] of Object.entries(copy.fields)) {
      // Strictly newer wins: on a tie the earlier source (already seen) keeps the field.
      if (times[name] === undefined || value.at > times[name]) {
        times[name] = value.at;
        fields[name] = value.v;
        fieldSources[name] = sourceId;
      }
      if (value.at > updatedAt) {
        updatedAt = value.at;
        updatedBy = sourceId;
      }
    }
  }
  return {
    kind,
    key,
    fields,
    fieldSources,
    born,
    updatedAt,
    updatedBy,
    holders: [...new Set(live.flatMap((c) => (c.copy.hidden ? [] : [c.sourceId])))],
    keepers: [...new Set(live.flatMap((c) => (c.copy.hidden ? [c.sourceId] : [])))],
  };
}

/** Splits the copies of one pair into holes: one per wormhole type named, the untyped joining the oldest. */
function groupHoles(live: readonly LiveCopy[]): Array<{ key: string | null; copies: LiveCopy[] }> {
  const typed = new Map<string, LiveCopy[]>();
  const untyped: LiveCopy[] = [];
  for (const copy of live) {
    const type = copy.copy.fields.whType?.v;
    if (typeof type === 'string' && type) {
      const list = typed.get(type);
      if (list) list.push(copy);
      else typed.set(type, [copy]);
    } else untyped.push(copy);
  }
  if (typed.size <= 1) return [{ key: null, copies: [...live] }];
  const groups = [...typed.entries()]
    .map(([type, copies]) => ({ type, copies, born: Math.min(...copies.map((c) => c.copy.born)) }))
    .sort((a, b) => a.born - b.born || a.type.localeCompare(b.type));
  return groups.map((group, index) => ({
    // The oldest hole keeps the plain pair key, so its id stays when a second type shows up.
    key: index === 0 ? null : group.type,
    copies: index === 0 ? [...group.copies, ...untyped].sort((a, b) => a.order - b.order) : group.copies,
  }));
}
