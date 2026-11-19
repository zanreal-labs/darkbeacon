'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EyeOff, Pencil } from 'lucide-react';
import { buildPath, MAP_MOTD_MAX, routes, type MapMotdDto } from '@darkbeacon/shared';
import { Markdown } from '../../components/Markdown';
import { api, ApiError } from '../../lib/api';
import { Button, IconButton, useToast } from '../../ui';
import { readStored, writeStored } from './storage';
import { WidgetWindow } from './WidgetWindow';
import styles from './widgets.module.css';

/** The messages each viewer hid, per map: a hidden one shows again once it changes. */
export const MOTD_HIDDEN_KEY = 'dbk-motd-hidden';

const isHiddenMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A short fingerprint of a message, kept instead of the message itself. */
export function motdFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

const readHidden = (): Record<string, string> =>
  (typeof window === 'undefined' ? null : readStored(MOTD_HIDDEN_KEY, isHiddenMap)) ?? {};

/** The map's message of the day as the map screen shows it. */
export interface MotdState {
  mapId: string;
  /** The message ('' for none). */
  text: string;
  /** The viewer may write it (map managers). */
  canEdit: boolean;
  /** The viewer hid this message (it shows again once it changes). */
  hidden: boolean;
  editing: boolean;
  /** Whether its window shows: a message the viewer did not hide, or one being written. */
  shown: boolean;
  hide(): void;
  show(): void;
  /** Opens the editor (and shows the window). */
  edit(): void;
  /** Closes the editor; `saved` is what the server now has, shown until the map's stream says so. */
  stopEditing(saved?: string): void;
}

/**
 * The map's message of the day for the map screen: shown to everyone who opens the map until
 * they hide it, and again for everyone as soon as it changes (hidden messages are remembered per
 * map as a fingerprint, a `dbk-*` option that follows the person).
 */
export function useMotd(mapId: string, motd: string | undefined, canEdit: boolean): MotdState {
  const live = motd ?? '';
  // What a save answered, kept only until the map's stream brings a message (this save, or
  // someone else's): `over` is the message it replaced.
  const [saved, setSaved] = useState<{ over: string; text: string } | null>(null);
  // The map being written for: another map opens without the editor.
  const [editingMap, setEditingMap] = useState<string | null>(null);
  const editing = editingMap === mapId && canEdit;
  const [hiddenByMap, setHiddenByMap] = useState(readHidden);

  // Another tab, or the preferences mirror, changed what is hidden.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MOTD_HIDDEN_KEY || e.key === null) setHiddenByMap(readHidden());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (saved && saved.over !== live) setSaved(null);
  const text = saved && saved.over === live ? saved.text : live;
  const hidden = text !== '' && hiddenByMap[mapId] === motdFingerprint(text);

  const remember = useCallback(
    (fingerprint: string | null) => {
      const next = { ...readHidden() };
      if (fingerprint) next[mapId] = fingerprint;
      else delete next[mapId];
      writeStored(MOTD_HIDDEN_KEY, next);
      setHiddenByMap(next);
    },
    [mapId],
  );

  return useMemo(
    () => ({
      mapId,
      text,
      canEdit,
      hidden,
      editing,
      shown: editing || (text !== '' && !hidden),
      hide: () => {
        setEditingMap(null);
        if (text) remember(motdFingerprint(text));
      },
      show: () => remember(null),
      edit: () => {
        remember(null);
        setEditingMap(mapId);
      },
      stopEditing: (next) => {
        if (next !== undefined) setSaved({ over: live, text: next });
        setEditingMap(null);
      },
    }),
    [mapId, live, text, canEdit, hidden, editing, remember],
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The map's message of the day: what the map's managers want everyone on it to read first (the
 * in-game channel, links, standing orders), as Markdown with links opening in a new tab. It does
 * not depend on the selected system. Managers edit it in place; anyone hides it until it changes.
 */
export function MotdWidget({ motd }: { motd: MotdState }) {
  return (
    <WidgetWindow
      id="motd"
      title="Message of the day"
      actions={
        !motd.editing && (
          <>
            {motd.canEdit && (
              <IconButton
                size="sm"
                label="Edit the message of the day"
                tooltipSide="left"
                icon={<Pencil />}
                onClick={motd.edit}
              />
            )}
            {motd.text && (
              <IconButton
                size="sm"
                label="Hide until it changes"
                tooltipSide="left"
                icon={<EyeOff />}
                onClick={motd.hide}
              />
            )}
          </>
        )
      }
    >
      {motd.editing ? <MotdEditor motd={motd} /> : <Markdown className={styles.motd} text={motd.text} />}
    </WidgetWindow>
  );
}

/** The message in a text field: Save (Ctrl/⌘+Enter) or Cancel (Escape); saving it empty clears it. */
function MotdEditor({ motd }: { motd: MotdState }) {
  const toast = useToast();
  const [draft, setDraft] = useState(motd.text);
  const [busy, setBusy] = useState(false);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<MapMotdDto>(buildPath(routes.maps.setMotd.path, { mapId: motd.mapId }), {
        method: 'PUT',
        json: { motd: draft },
      });
      motd.stopEditing(result.motd);
    } catch (error) {
      toast({
        title: 'Could not save the message of the day',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      });
      setBusy(false);
    }
  };

  return (
    <form className={styles.motdEditor} onSubmit={(e) => void save(e)}>
      <textarea
        className={styles.notes}
        aria-label="Message of the day"
        rows={6}
        maxLength={MAP_MOTD_MAX}
        // Opened on purpose (the pencil, the widgets menu): the text is what comes next.
        autoFocus
        placeholder={'The in-game channel, links, standing orders…\nMarkdown: **bold**, [a link](https://…)'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            motd.stopEditing();
          }
        }}
      />
      <div className={styles.motdButtons}>
        <span className={styles.motdHint}>
          {draft.length > MAP_MOTD_MAX * 0.8
            ? `${draft.length}/${MAP_MOTD_MAX}`
            : `Everyone on the map sees it. ${isMac ? '⌘' : 'Ctrl'}+Enter saves.`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => motd.stopEditing()} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
