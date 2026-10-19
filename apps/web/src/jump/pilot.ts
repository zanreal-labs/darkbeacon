'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buildPath, routes, type CharacterDto, type JumpPilotDto, type JumpSkills } from '@darkbeacon/shared';
import { api } from '../lib/api';
import { useMe } from '../lib/session';

export const jumpPilotKey = (characterId: number | null) => ['jumps', 'pilot', characterId] as const;

/** What ESI fills the planner with for the pilot, and what the panel says about it. */
export interface PilotFill {
  /** My characters, the ones the pilot can be. */
  characters: readonly CharacterDto[];
  /** The pilot: the character picked here, else my main, else the first; null without characters. */
  pilot: CharacterDto | null;
  /** ESI's last answer for the pilot. */
  answer: JumpPilotDto | null;
  fetching: boolean;
  error: Error | null;
  /** Skill levels from ESI while no manual edit came after them; null: the planner's own. */
  skills: JumpSkills | null;
  /**
   * When ESI's fatigue runs out (null: none) while no manual edit came after it; undefined: the
   * planner's own number.
   */
  fatigueExpiresAt: number | null | undefined;
  /** When the answer came (epoch ms); fatigue is never counted from before it. */
  answeredAt: number;
  /** Asks ESI again; its answer wins over manual edits. */
  refresh(): void;
  /** A level or the fatigue was changed by hand: it stays until ESI is asked again. */
  edited(part: 'skills' | 'fatigue'): void;
}

/**
 * The pilot's skills and jump fatigue from ESI (the opt-in extra `jumps`), asked for when the
 * planner opens, when the pilot changes and on refresh, not in the background: a manual edit
 * keeps until then.
 */
export function useJumpPilot(chosen: number | null): PilotFill {
  const me = useMe();
  const characters = me.data?.characters ?? [];
  const pilot =
    characters.find((c) => c.id === chosen) ??
    characters.find((c) => c.id === me.data?.account.mainCharacterId) ??
    characters[0] ??
    null;
  const id = pilot?.id ?? null;
  const query = useQuery({
    queryKey: jumpPilotKey(id),
    queryFn: () => api<JumpPilotDto>(buildPath(routes.jumps.pilot.path, { characterId: String(id) })),
    enabled: id !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const answer = query.data?.characterId === id ? query.data : null;
  const answeredAt = answer ? query.dataUpdatedAt : 0;
  // The answer (by when it came) each part was last edited after; a newer answer wins again.
  const [editedAfter, setEditedAfter] = useState({ skills: -1, fatigue: -1 });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const edited = useCallback(
    (part: 'skills' | 'fatigue') =>
      setEditedAfter((e) => (e[part] === answeredAt ? e : { ...e, [part]: answeredAt })),
    [answeredAt],
  );
  const fresh = (part: 'skills' | 'fatigue') => answer !== null && editedAfter[part] !== answeredAt;
  return {
    characters,
    pilot,
    answer,
    fetching: query.isFetching,
    error: query.error,
    skills: fresh('skills') ? (answer!.skills ?? null) : null,
    fatigueExpiresAt:
      fresh('fatigue') && answer!.fatigueMinutes !== null ? answer!.fatigueExpiresAt : undefined,
    answeredAt,
    refresh,
    edited,
  };
}

/**
 * The time for counting fatigue down: every 30 s while there is ESI fatigue to count, and never
 * before `since` (the answer it counts from), so a planner left open shows it current.
 */
export function useFatigueClock(counting: boolean, since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [counting]);
  return Math.max(now, since);
}
