import {
  isMergeEvent,
  LOCAL_INSTANCE,
  type LockedBy,
  type LockHolderDto,
  type MapRole,
  type MapSourceDto,
  type ProvenanceDto,
  type TypedEvent,
} from '@darkbeacon/shared';
import { atLeast, type MapPermissions } from '../../lib/roles';
import type { MapState } from '../mapState';

/** Events about a map's objects (what a merged map replaces with its merged ones). */
const OBJECT_EVENTS = /^(system|connection|signature|character)\./;

/**
 * On a merged map only the merged view's events change systems, connections, signatures and
 * characters: those sharing wrote (the merge itself) and moves on the map's own layout (they carry
 * a provenance). The map's own events about its rows are history, not what it shows.
 */
export function fromMergedView(event: TypedEvent): boolean {
  if (!OBJECT_EVENTS.test(event.type)) return true;
  if (isMergeEvent(event)) return true;
  const data = event.data as { provenance?: unknown };
  return typeof data === 'object' && data !== null && data.provenance !== undefined;
}

/** A map starts merging others: its own rows (without provenance) leave; merged ones replace them. */
export function enteringMerged(state: MapState): MapState {
  return {
    ...state,
    connections: new Map([...state.connections].filter(([, c]) => c.provenance !== undefined)),
    signatures: new Map([...state.signatures].filter(([, s]) => s.provenance !== undefined)),
  };
}

/**
 * What the viewer may do with one object of a merged map: edit it when some map that takes
 * writes holds it (its own objects, read-write shares); lock and label the map's own objects,
 * and on a composite every system (it keeps its labels and locks itself). Plain maps keep the
 * role's permissions.
 */
export function permissionsFor(
  can: MapPermissions,
  provenance: ProvenanceDto | undefined,
  composite = false,
): MapPermissions {
  if (!provenance) return can;
  const own = composite || provenance.sources.includes('self');
  return { ...can, edit: can.edit && provenance.writable, manage: can.manage && own };
}

/** A lockable object as the map shows it (merged ones say where the lock is held). */
export interface Lockable {
  locked?: boolean;
  lockedBy?: LockedBy;
  lockedOn?: readonly LockHolderDto[];
}

/** Where a system's or connection's lock is held, and what the viewer may do about it. */
export interface LockView {
  locked: boolean;
  /** Held on this map (a composite's own lock, the map's own objects, any plain map's). */
  here: boolean;
  /** Names of the merged maps holding it, while this map does not. */
  on: string[];
  /** The viewer may lift the lock that holds now: here as this map's manager, else as a manager of each map. */
  canUnlock: boolean;
  /** The viewer may change or remove what it locks (a connection): a manager wherever it is held. */
  canOverride: boolean;
}

/**
 * The lock of an object. `manageHere`: the viewer manages this map; `managesSource`: whether
 * they manage the map behind a source (`MapSourceDto.id`), which alone lifts that map's lock.
 */
export function lockView(
  object: Lockable,
  manageHere: boolean,
  managesSource: (sourceId: string) => boolean = () => false,
): LockView {
  const locked = object.locked ?? false;
  const here = locked && object.lockedBy !== 'source';
  const holders = object.lockedOn ?? [];
  const sourcesOk = holders.every((h) => managesSource(h.sourceId));
  return {
    locked,
    here,
    on: here ? [] : holders.map((h) => h.name),
    canUnlock: locked && (here ? manageHere : holders.length > 0 && sourcesOk),
    canOverride: !locked || ((!here || manageHere) && sourcesOk),
  };
}

/** Locked on this map itself (not only on a map it merges). */
export const lockedHere = (object: Lockable) => lockView(object, false).here;

/** "Locked", or "Locked on Corp A" while only a merged map holds the lock. */
export function lockedText(object: Lockable): string {
  const { here, on } = lockView(object, false);
  return here || on.length === 0 ? 'Locked' : `Locked on ${mapNames(on)}`;
}

/** "Corp A", "Corp A and Corp B". */
export function mapNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Whether the viewer manages the map behind a source, from their maps list (their role on each):
 * only maps of this instance, and only the ones they can see at all.
 */
export function sourceManager(
  sources: readonly MapSourceDto[] | null,
  roles: ReadonlyArray<{ id: string; role: MapRole }> | undefined,
): (sourceId: string) => boolean {
  return (sourceId) => {
    const source = sources?.find((s) => s.id === sourceId);
    if (!source || source.origin.instance !== LOCAL_INSTANCE) return false;
    return atLeast(roles?.find((m) => m.id === source.origin.mapId)?.role, 'manager');
  };
}

/** The sources a viewer can filter by: every merged map but the map's own objects. */
export function filterableSources(sources: readonly MapSourceDto[] | null): MapSourceDto[] {
  return (sources ?? []).filter((s) => s.id !== 'self' && !s.hidden);
}

/**
 * The state without what only hidden sources hold (a viewer's own filter, nothing is changed on
 * the server). Connections and signatures go with their systems.
 */
export function withoutSources(state: MapState, hidden: ReadonlySet<string>): MapState {
  if (!state.sources || hidden.size === 0) return state;
  const shown = (p: ProvenanceDto | undefined) => !p || p.sources.some((s) => !hidden.has(s));
  const systems = new Map([...state.systems].filter(([, s]) => shown(s.provenance)));
  return {
    ...state,
    systems,
    connections: new Map(
      [...state.connections].filter(
        ([, c]) => shown(c.provenance) && systems.has(c.source) && systems.has(c.target),
      ),
    ),
    signatures: new Map(
      [...state.signatures].filter(([, s]) => shown(s.provenance) && systems.has(s.solarSystemId)),
    ),
  };
}
