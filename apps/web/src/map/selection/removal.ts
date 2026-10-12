import type { ConnectionDto, MapSystemDto } from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';

/** Why a selected thing stays when the selection is removed. */
export type KeptReason = 'locked' | 'rally' | 'locked connection';

export interface RemovalPlan {
  systems: number[];
  connections: string[];
  kept: Array<{ solarSystemId: number; reason: KeptReason }>;
  /** Selected connections that stay (locked, and the viewer is no manager). */
  keptConnections: number;
}

/**
 * What Delete removes of a selection, as Wanderer does it: unlocked systems without a rally
 * ping, and connections the viewer may remove (locked ones are for managers). Connections of a
 * removed system go with it anyway, so they are not counted twice.
 */
export function planRemoval(
  selected: { systems: readonly number[]; connections: readonly string[] },
  state: { systems: ReadonlyMap<number, MapSystemDto>; connections: ReadonlyMap<string, ConnectionDto> },
  can: Pick<MapPermissions, 'edit' | 'manage'>,
  pinged: ReadonlySet<number>,
): RemovalPlan {
  const plan: RemovalPlan = { systems: [], connections: [], kept: [], keptConnections: 0 };
  if (!can.edit) return plan;
  for (const id of selected.systems) {
    const system = state.systems.get(id);
    if (!system) continue;
    if (system.locked) plan.kept.push({ solarSystemId: id, reason: 'locked' });
    else if (pinged.has(id)) plan.kept.push({ solarSystemId: id, reason: 'rally' });
    else {
      // A locked connection keeps its systems for managers to remove.
      const lockedLink = [...state.connections.values()].some(
        (c) => c.locked && (c.source === id || c.target === id),
      );
      if (lockedLink && !can.manage) plan.kept.push({ solarSystemId: id, reason: 'locked connection' });
      else plan.systems.push(id);
    }
  }
  const going = new Set(plan.systems);
  for (const id of selected.connections) {
    const connection = state.connections.get(id);
    if (!connection || id.startsWith('pending:')) continue;
    if (going.has(connection.source) || going.has(connection.target)) continue;
    if (connection.locked && !can.manage) plan.keptConnections += 1;
    else plan.connections.push(id);
  }
  return plan;
}

const REASON_TEXT: Record<KeptReason, string> = {
  locked: 'locked',
  rally: 'a rally point',
  'locked connection': 'held by a locked connection',
};

/** "J123456 stays: it is locked." for the toast after a removal, or null when nothing stayed. */
export function keptText(plan: RemovalPlan, nameOf: (id: number) => string): string | null {
  const parts = plan.kept.map((k) => `${nameOf(k.solarSystemId)} is ${REASON_TEXT[k.reason]}`);
  if (plan.keptConnections > 0)
    parts.push(
      `${plan.keptConnections} locked connection${plan.keptConnections === 1 ? '' : 's'} need a manager`,
    );
  return parts.length > 0 ? `${parts.join('; ')}.` : null;
}
