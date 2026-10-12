'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildPath, routes, type RemovedSignaturesDto, type SignatureDto } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../ui';
import { signaturePrefs } from './prefs';

/*
 * Removed signatures that can still be put back, per system: removals happen on the server at
 * once (everyone sees them go), and for the undo window this browser keeps what went, shows it
 * as red rows with a countdown and can restore it (Ctrl+Z or the undo button).
 *
 * A map-wide undo stack takes the same removals as `UndoableAction`s: `signatureUndoables`
 * (or `useSignatureUndoables`) lists the ones still in their window, `subscribeSignatureUndo`
 * says when that list changes, and each action's `undo()` puts its signatures back and drops
 * it from the sidebar's undo bar too, so both stay in step.
 */

export interface UndoBatch {
  id: number;
  mapId: string;
  solarSystemId: number;
  signatures: SignatureDto[];
  until: number;
}

/** One step a shared undo stack can take back. */
export interface UndoableAction {
  /** Stable while the action lives (`signatures:<n>`). */
  key: string;
  mapId: string;
  /** What undoing brings back, for a history list ("3 signatures in J123456" is up to the caller). */
  label: string;
  solarSystemId: number;
  /** When it can no longer be undone (epoch ms). */
  until: number;
  /** Puts the signatures back: how many came back and how many could not (scanned again or gone). */
  undo(): Promise<{ restored: number; missed: number }>;
}

let batches: UndoBatch[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function prune(now = Date.now()) {
  const kept = batches.filter((b) => b.until > now);
  if (kept.length !== batches.length) {
    batches = kept;
    emit();
  }
}

/** Keeps removed signatures for the undo window of the preferences (nothing when it is 0). */
export function rememberRemoved(
  mapId: string,
  solarSystemId: number,
  signatures: readonly SignatureDto[],
): void {
  const seconds = signaturePrefs().undoSeconds;
  if (seconds === 0 || signatures.length === 0) return;
  batches = [
    ...batches,
    { id: ++nextId, mapId, solarSystemId, signatures: [...signatures], until: Date.now() + seconds * 1000 },
  ];
  emit();
  setTimeout(() => prune(), seconds * 1000 + 50);
}

export function forgetUndo(id: number): void {
  batches = batches.filter((b) => b.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts removed signatures back (and out of the undo bar); throws when the server says no. */
export async function restoreSignatures(
  mapId: string,
  undo: readonly UndoBatch[],
): Promise<{ restored: number; missed: number }> {
  if (undo.length === 0) return { restored: 0, missed: 0 };
  undo.forEach((b) => forgetUndo(b.id));
  const signatures = undo.flatMap((b) => b.signatures);
  const back = await api<SignatureDto[]>(buildPath(routes.signatures.restore.path, { mapId }), {
    method: 'POST',
    json: { signatures },
  });
  return { restored: back.length, missed: signatures.length - back.length };
}

const asAction = (batch: UndoBatch): UndoableAction => ({
  key: `signatures:${batch.id}`,
  mapId: batch.mapId,
  label: `${batch.signatures.length} signature${batch.signatures.length === 1 ? '' : 's'} removed`,
  solarSystemId: batch.solarSystemId,
  until: batch.until,
  undo: () => restoreSignatures(batch.mapId, [batch]),
});

/** The signature removals of a map that can still be undone, oldest first. */
export function signatureUndoables(mapId: string, now = Date.now()): UndoableAction[] {
  return batches.filter((b) => b.mapId === mapId && b.until > now).map(asAction);
}

/** Calls `listener` whenever a removal is remembered, undone or runs out; returns the unsubscribe. */
export function subscribeSignatureUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `signatureUndoables` as a hook: re-renders when the list changes. */
export function useSignatureUndoables(mapId: string): UndoableAction[] {
  const all = useSyncExternalStore(
    subscribe,
    () => batches,
    () => batches,
  );
  return useMemo(() => all.filter((b) => b.mapId === mapId).map(asAction), [all, mapId]);
}

/** The undo batches of one system, newest last, with a countdown that ticks every second. */
export function useUndo(solarSystemId: number) {
  const all = useSyncExternalStore(
    subscribe,
    () => batches,
    () => batches,
  );
  const mine = all.filter((b) => b.solarSystemId === solarSystemId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (mine.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [mine.length]);
  const pending = mine.filter((b) => b.until > now);
  const secondsLeft = pending.length
    ? Math.max(1, Math.ceil((Math.max(...pending.map((b) => b.until)) - now) / 1000))
    : 0;
  return { batches: pending, secondsLeft };
}

/** Removing (with the cascades of the preferences) and putting back signatures of a map. */
export function useSignatureRemoval(mapId: string) {
  const toast = useToast();
  const remove = useCallback(
    async (solarSystemId: number, ids: readonly string[]): Promise<RemovedSignaturesDto | null> => {
      if (ids.length === 0) return null;
      const prefs = signaturePrefs();
      try {
        const removed = await api<RemovedSignaturesDto>(
          buildPath(routes.signatures.removeMany.path, { mapId, solarSystemId }),
          {
            method: 'POST',
            json: { ids, withConnections: prefs.deleteConnectionWithSigs, backLinks: prefs.backLinks },
          },
        );
        // The far side's signatures come back with the undo too.
        rememberRemoved(mapId, solarSystemId, removed.signatures);
        return removed;
      } catch (error) {
        toast({
          title: 'Could not remove the signatures',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        });
        return null;
      }
    },
    [mapId, toast],
  );

  const restore = useCallback(
    async (undo: readonly UndoBatch[]) => {
      if (undo.length === 0) return;
      try {
        const { restored, missed } = await restoreSignatures(mapId, undo);
        toast({
          title: `${restored} signature${restored === 1 ? '' : 's'} back`,
          description: missed > 0 ? `${missed} could not come back (scanned again or gone)` : undefined,
          tone: missed > 0 ? 'warning' : 'success',
        });
      } catch (error) {
        toast({
          title: 'Could not put the signatures back',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        });
      }
    },
    [mapId, toast],
  );

  return { remove, restore };
}
