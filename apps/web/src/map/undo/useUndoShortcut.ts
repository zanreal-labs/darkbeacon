'use client';

import { useCallback, useEffect } from 'react';
import { track } from '../../lib/telemetry';
import type { ToastInput } from '../../ui';
import type { MapStore } from '../useMapStore';
import { lowerFirst } from './undoStack';

/** Keys typed into a field undo the field, not the map. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Ctrl+Z (Cmd+Z on a Mac) undoes the newest gesture of this tab and says what it undid. Returns
 * the same undo for menus.
 */
export function useUndoShortcut(
  undoNewest: MapStore['undo'],
  toast: (toast: ToastInput) => void,
  enabled: boolean,
): () => void {
  const undo = useCallback(() => {
    void undoNewest().then((done) => {
      if (!done) {
        toast({ title: 'Nothing to undo', tone: 'info', duration: 2000 });
        return;
      }
      const what = lowerFirst(done.label);
      if (done.outcome.ok) {
        toast({
          title: `Undone: ${what}`,
          description: done.outcome.partly ? `Some of it stayed: ${done.outcome.partly}` : undefined,
          tone: done.outcome.partly ? 'warning' : 'success',
          duration: 3000,
        });
      } else {
        toast({ title: `Could not undo: ${what}`, description: done.outcome.reason, tone: 'danger' });
      }
    });
  }, [undoNewest, toast]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey || typing(e.target)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      track('shortcut_used', { shortcut: 'undo' });
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, undo]);

  return undo;
}
