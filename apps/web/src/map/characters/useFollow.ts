'use client';

import { useEffect, useRef } from 'react';
import type { CharacterPresenceDto } from '@darkbeacon/shared';

/**
 * Follow mode (Wanderer's "following"): whenever the followed character arrives in another
 * system, `onArrive` selects and centres it. The system it is in when following starts is not
 * an arrival, so turning follow on does not move the view by itself. But a map opened with follow
 * already on (`opening.loaded`: the setting is known) selects the character's system once, as soon
 * as it is on the map, so a pilot in flight has their system in the widgets from the start.
 */
export function useFollowCharacter(
  characters: ReadonlyMap<number, CharacterPresenceDto>,
  followCharacterId: number | null,
  onArrive: (solarSystemId: number) => void,
  opening?: { loaded: boolean; onMap(solarSystemId: number): boolean },
): void {
  const at = followCharacterId === null ? null : (characters.get(followCharacterId)?.solarSystemId ?? null);
  const last = useRef<{ id: number | null; at: number | null }>({ id: followCharacterId, at });
  const latest = useRef(onArrive);
  const shown = useRef<number | null>(null);
  useEffect(() => {
    latest.current = onArrive;
  });
  useEffect(() => {
    const previous = last.current;
    last.current = { id: followCharacterId, at };
    if (followCharacterId === null || at === null) return;
    if (previous.id !== followCharacterId || previous.at === null || previous.at === at) return;
    shown.current = at;
    latest.current(at);
  }, [followCharacterId, at]);

  // On opening: who was followed when the setting first became known, until their system is shown.
  const loaded = opening?.loaded ?? false;
  const atOpening = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (loaded && atOpening.current === undefined) atOpening.current = followCharacterId;
  }, [loaded, followCharacterId]);
  const ready = loaded && at !== null && (opening?.onMap(at) ?? false);
  useEffect(() => {
    if (!ready || at === null || atOpening.current == null) return;
    if (atOpening.current === followCharacterId && shown.current !== at) latest.current(at);
    atOpening.current = null;
  }, [ready, at, followCharacterId]);
}

/** The character whose arrival the map follows, among characters tracked on it. */
export function followedPresence(
  characters: ReadonlyMap<number, CharacterPresenceDto>,
  followCharacterId: number | null,
): CharacterPresenceDto | null {
  return followCharacterId === null ? null : (characters.get(followCharacterId) ?? null);
}
