'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound, UserX } from 'lucide-react';
import { buildPath, routes, type MapDto, type MapTrackedCharacterDto } from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/time';
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  SkeletonRows,
  Stack,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const portrait = (id: number) => `https://images.evetech.net/characters/${id}/portrait?size=64`;

/**
 * The map's characters page (managers, as in Wanderer): every character tracked on the map,
 * grouped by the person it belongs to, and taking a character off the map.
 */
export function MapCharactersSection({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['map-tracked-characters', map.id];
  const characters = useQuery({
    queryKey: key,
    queryFn: () =>
      api<MapTrackedCharacterDto[]>(buildPath(routes.mapCharacters.list.path, { mapId: map.id })),
    refetchInterval: 30_000,
  });
  const [untracking, setUntracking] = useState<MapTrackedCharacterDto | null>(null);
  const untrack = useMutation({
    mutationFn: (characterId: number) =>
      api<void>(buildPath(routes.mapCharacters.untrack.path, { mapId: map.id, characterId }), {
        method: 'DELETE',
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) =>
      toast({
        title: 'Could not stop tracking',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });

  const groups = new Map<string, { name: string; list: MapTrackedCharacterDto[] }>();
  for (const c of characters.data ?? []) {
    const group = groups.get(c.accountId) ?? { name: c.accountName ?? 'A removed account', list: [] };
    group.list.push(c);
    groups.set(c.accountId, group);
  }
  const online = (characters.data ?? []).filter((c) => c.online).length;

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Characters on this map"
          description={
            characters.data
              ? `${characters.data.length} tracked, ${online} online. Taking one off stops its tracking here; its owner can track it again.`
              : 'Every character tracked here, by person.'
          }
        />
        <CardBody flush>
          {characters.isPending ? (
            <SkeletonRows count={3} />
          ) : characters.isError ? (
            <ErrorState compact error={characters.error} onRetry={() => void characters.refetch()} />
          ) : groups.size === 0 ? (
            <EmptyState
              compact
              icon={<UserRound />}
              title="Nobody tracks a character here"
              description="People start tracking from the map's toolbar."
            />
          ) : (
            <ul className={styles.list} aria-label="Tracked characters">
              {[...groups.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .flatMap((group) =>
                  group.list.map((c) => (
                    <li key={c.characterId} className={`${styles.item} ${styles.itemCenter}`}>
                      <Avatar src={portrait(c.characterId)} name={c.name} size={32} />
                      <div className={styles.rowBody}>
                        <div className={styles.rowTitle}>{c.name}</div>
                        <div className={styles.rowMeta}>
                          {group.name} · tracked {relativeTime(c.since)}
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        <Badge tone={c.online ? 'success' : 'neutral'} dot>
                          {c.online ? 'Online' : 'Offline'}
                        </Badge>
                        <IconButton
                          size="sm"
                          label={`Stop tracking ${c.name} here`}
                          icon={<UserX />}
                          onClick={() => setUntracking(c)}
                        />
                      </div>
                    </li>
                  )),
                )}
            </ul>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={untracking !== null}
        onOpenChange={(open) => !open && setUntracking(null)}
        title={`Stop tracking ${untracking?.name ?? 'this character'} on ${map.name}?`}
        description="It disappears from the map at once and auto-mapping stops following it here."
        confirmLabel="Stop tracking"
        tone="danger"
        onConfirm={() => untracking && untrack.mutateAsync(untracking.characterId)}
      />
    </Stack>
  );
}
