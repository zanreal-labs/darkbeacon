import type { TypedEvent } from '@darkbeacon/shared';
import type { MapState } from './mapState';

/**
 * A local change shown before the server confirms it. It stays applied until its request
 * succeeded AND a matching event arrived (or a grace period passed), and is dropped at once
 * when the request fails, which rolls the view back to the confirmed state.
 */
export interface PendingChange {
  id: number;
  apply(state: MapState): MapState;
  /** True for the stream event that carries the result of this change. */
  confirmedBy(event: TypedEvent): boolean;
  settled: boolean;
  confirmed: boolean;
}

export function withPending(confirmed: MapState, pending: readonly PendingChange[]): MapState {
  return pending.reduce((state, change) => change.apply(state), confirmed);
}

/** Marks changes confirmed by `event` and drops the ones that are also settled. */
export function confirmPending(pending: PendingChange[], event: TypedEvent): PendingChange[] {
  let changed = false;
  const next: PendingChange[] = [];
  for (const change of pending) {
    if (change.confirmed || !change.confirmedBy(event)) {
      next.push(change);
      continue;
    }
    changed = true;
    if (!change.settled) next.push({ ...change, confirmed: true });
  }
  return changed ? next : pending;
}

/** The request succeeded: drop the change if its event already arrived, else wait for it. */
export function settlePending(pending: PendingChange[], id: number): PendingChange[] {
  return pending.flatMap((c) => (c.id !== id ? [c] : c.confirmed ? [] : [{ ...c, settled: true }]));
}

export function dropPending(pending: PendingChange[], id: number): PendingChange[] {
  return pending.filter((c) => c.id !== id);
}
