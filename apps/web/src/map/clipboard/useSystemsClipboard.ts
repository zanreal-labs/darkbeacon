'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ACTION_HEADER,
  buildPath,
  routes,
  type LabelDto,
  type MapDto,
  type MapRole,
  type PasteSystemsResultDto,
  type Position,
  type SystemLabelDto,
  type SystemsClipboard,
} from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { track } from '../../lib/telemetry';
import type { ToastInput } from '../../ui';
import type { MapState } from '../mapState';
import { count } from '../undo/labels';
import { newActionId, undoAction } from '../undo/undoStack';
import type { MapStore } from '../useMapStore';
import { copiedSystems, readCopiedSystems, roleReaches } from './systems';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

interface Options {
  map: MapDto;
  role: MapRole | null | undefined;
  state: MapState;
  systemLabels: readonly SystemLabelDto[];
  tags: readonly LabelDto[];
  store: Pick<MapStore, 'pushUndo'>;
  toast(toast: ToastInput): void;
  /** The systems selected on the canvas now. */
  selected(): number[];
  /** Where a paste lands: the pointer on the canvas, else the middle of the view. */
  pasteAt(): Position;
  /** The map's own systems can be pasted on (composite maps only show others'). */
  editable: boolean;
}

/**
 * Copy and paste of systems: Ctrl+C on a selection, Ctrl+V on the map (a scanner paste still goes
 * to the signatures), and the same from the menus. Who may do which is the map's clipboard roles.
 */
export function useSystemsClipboard(options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const roles = options.map.settings.clipboard ?? { copy: 'viewer', paste: 'member' };
  const canCopy = roleReaches(options.role, roles.copy);
  const canPaste =
    options.editable && roleReaches(options.role, roles.paste) && roleReaches(options.role, 'member');

  const copy = useCallback((ids: readonly number[]) => {
    const { map, state, systemLabels, tags, toast } = latest.current;
    const payload = copiedSystems(map, state, ids, { systemLabels, tags });
    if (!payload) return;
    const n = count(payload.systems.length, 'system');
    void navigator.clipboard
      ?.writeText(JSON.stringify(payload))
      .then(() =>
        toast({
          title: `Copied ${n}`,
          description:
            payload.connections && payload.connections.length > 0
              ? `With ${count(payload.connections.length, 'connection')}. Paste them on any map with Ctrl+V.`
              : 'Paste them on any map with Ctrl+V.',
          tone: 'success',
          duration: 2500,
        }),
      )
      .catch(() => toast({ title: 'The browser did not allow copying', tone: 'danger' }));
  }, []);

  const paste = useCallback(async (clipboard: SystemsClipboard, at: Position) => {
    const { map, store, toast } = latest.current;
    const action = newActionId();
    try {
      const result = await api<PasteSystemsResultDto>(
        buildPath(routes.clipboard.paste.path, { mapId: map.id }),
        {
          method: 'POST',
          json: { clipboard, at: { x: Math.round(at.x), y: Math.round(at.y) } },
          headers: { [ACTION_HEADER]: action },
        },
      );
      const n = count(result.added.length, 'system');
      if (result.added.length + result.connections > 0)
        store.pushUndo({ label: `Pasted ${n}`, undo: () => undoAction(map.id, action) });
      const notes = [
        result.existing.length > 0 ? `${count(result.existing.length, 'system')} already here` : null,
        result.missingLabels.length > 0 ? `no ${result.missingLabels.join(', ')} on this map` : null,
      ].filter(Boolean);
      toast({
        title: result.added.length > 0 ? `Pasted ${n}` : 'Nothing new to paste',
        description:
          notes.length > 0 ? `${notes.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : undefined,
        tone: result.added.length > 0 ? 'success' : 'info',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: 'Could not paste the systems',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      });
    }
  }, []);

  /** The menu's "Paste systems here": reads the clipboard (the browser may ask first). */
  const pasteFromClipboard = useCallback(
    async (at: Position) => {
      const { toast } = latest.current;
      try {
        const text = (await navigator.clipboard?.readText()) ?? '';
        const clipboard = readCopiedSystems(text);
        if (!clipboard) {
          toast({ title: 'No copied systems on the clipboard', tone: 'info', duration: 2500 });
          return;
        }
        await paste(clipboard, at);
      } catch {
        toast({
          title: 'The browser did not let the map read the clipboard',
          description: 'Press Ctrl+V on the map instead.',
          tone: 'warning',
        });
      }
    },
    [paste],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canCopy || e.defaultPrevented || e.altKey || e.shiftKey || typing(e.target)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
      // Text selected on the page is copied as text.
      if (window.getSelection()?.toString()) return;
      const ids = latest.current.selected();
      if (ids.length === 0) return;
      e.preventDefault();
      track('shortcut_used', { shortcut: 'copy_selection' });
      copy(ids);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!canPaste || e.defaultPrevented || typing(e.target)) return;
      const clipboard = readCopiedSystems(e.clipboardData?.getData('text/plain') ?? '');
      if (!clipboard) return;
      e.preventDefault();
      track('shortcut_used', { shortcut: 'paste_systems' });
      void paste(clipboard, latest.current.pasteAt());
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [canCopy, canPaste, copy, paste]);

  return { canCopy, canPaste, copy, pasteFromClipboard };
}
