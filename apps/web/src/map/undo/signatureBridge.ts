'use client';

import { useEffect, useRef } from 'react';
import { useSignatureUndoables } from '../signatures/undo';
import type { MapStore } from '../useMapStore';

/**
 * Removed signatures join the map's undo stack: one stack for Ctrl+Z, whatever was removed. While
 * a removal is in the sidebar's undo window it is an entry; when the window runs out, or the
 * sidebar's undo button puts it back, the entry goes too.
 */
export function useSignatureUndoBridge(
  mapId: string,
  store: Pick<MapStore, 'pushUndo' | 'forgetUndo'>,
  nameOf: (solarSystemId: number) => string,
): void {
  const { pushUndo, forgetUndo } = store;
  const actions = useSignatureUndoables(mapId);
  const entries = useRef(new Map<string, number>());
  const names = useRef(nameOf);
  useEffect(() => {
    names.current = nameOf;
  });
  useEffect(() => {
    const live = new Set(actions.map((a) => a.key));
    for (const [key, id] of entries.current) {
      if (live.has(key)) continue;
      entries.current.delete(key);
      forgetUndo(id);
    }
    for (const action of actions) {
      if (entries.current.has(action.key) || action.until <= Date.now()) continue;
      const id = pushUndo({
        label: `Removed ${action.label.replace(/ removed$/, '')} in ${names.current(action.solarSystemId)}`,
        undo: async () => {
          entries.current.delete(action.key);
          try {
            const { restored, missed } = await action.undo();
            if (restored === 0) return { ok: false, reason: 'They were scanned again or are gone' };
            return missed > 0 ? { ok: true, partly: `${missed} could not come back` } : { ok: true };
          } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : 'Network error' };
          }
        },
      });
      entries.current.set(action.key, id);
    }
  }, [actions, pushUndo, forgetUndo]);
}
