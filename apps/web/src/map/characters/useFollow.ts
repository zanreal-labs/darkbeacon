'use client';

import { useEffect, useRef } from 'react';
import type { CharacterPresenceDto } from '@darkbeacon/shared';

/**
 * Follow mode (Wanderer's "following"): whenever the followed character arrives in another
 * system, `onArrive` selects and centres it. The system it is in when following starts is not
 * an arrival, so turning follow on does not move the view by itself.
 */
export function useFollowCharacter(
  characters: ReadonlyMap<number, CharacterPresenceDto>,
  followCharacterId: number | null,
  onArrive: (solarSystemId: number) => void,
): void {
  const at = followCharacterId === null ? null : (characters.get(followCharacterId)?.solarSystemId ?? null);
  const last = useRef<{ id: number | null; at: number | null }>({ id: followCharacterId, at });
  const latest = useRef(onArrive);
  useEffect(() => {
    latest.current = onArrive;
  });
  useEffect(() => {
    const previous = last.current;
    last.current = { id: followCharacterId, at };
    if (followCharacterId === null || at === null) return;
    if (previous.id !== followCharacterId || previous.at === null || previous.at === at) return;
    latest.current(at);
  }, [followCharacterId, at]);
}

/** The character whose arrival the map follows, among characters tracked on it. */
export function followedPresence(
  characters: ReadonlyMap<number, CharacterPresenceDto>,
  followCharacterId: number | null,
): CharacterPresenceDto | null {
  return followCharacterId === null ? null : (characters.get(followCharacterId) ?? null);
}
