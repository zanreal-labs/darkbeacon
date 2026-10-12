import type { MapSourceDto, ProvenanceDto, TypedEvent } from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
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
  if (event.actor.kind === 'system' && event.actor.id === 'sharing') return true;
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
 * writes holds it (its own objects, read-write shares); lock and label only the map's own.
 * Plain maps keep the role's permissions.
 */
export function permissionsFor(can: MapPermissions, provenance: ProvenanceDto | undefined): MapPermissions {
  if (!provenance) return can;
  const own = provenance.sources.includes('self');
  return { ...can, edit: can.edit && provenance.writable, manage: can.manage && own };
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
