'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';
import { buildPath, routes, type AdminCharacterDto, type EveEntityDto } from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CharacterAvatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  SkeletonRows,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export const adminCharactersKey = ['admin-characters'] as const;

/** Rows shown at once; the filter narrows the rest. */
const LIMIT = 200;

/** Names and tickers of EVE characters, corporations and alliances, by id. */
export function useEveNames(ids: readonly number[]) {
  // The endpoint takes up to 500 ids at a time.
  const unique = [...new Set(ids)].sort((a, b) => a - b).slice(0, 500);
  const entities = useQuery({
    queryKey: ['eve-entities', unique.join(',')],
    queryFn: () => api<EveEntityDto[]>(`${routes.eve.entities.path}?ids=${unique.join(',')}`),
    enabled: unique.length > 0,
    staleTime: 60 * 60_000,
  });
  return {
    isPending: unique.length > 0 && entities.isPending,
    /** "Name [TICK]", or null while unknown. */
    name: (id: number | null) => {
      const e = id ? entities.data?.find((x) => x.id === id) : undefined;
      return e ? `${e.name}${e.ticker ? ` [${e.ticker}]` : ''}` : null;
    },
  };
}

/** Every EVE character linked to an account on this instance, for its admins. */
export function AdminCharactersCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [unlinking, setUnlinking] = useState<AdminCharacterDto | null>(null);
  const characters = useQuery({
    queryKey: adminCharactersKey,
    queryFn: () => api<AdminCharacterDto[]>(routes.adminIdentity.characters.path),
  });
  const groups = useEveNames(
    (characters.data ?? []).flatMap((c) => [c.corporationId, ...(c.allianceId ? [c.allianceId] : [])]),
  );
  const unlink = useMutation({
    mutationFn: (c: AdminCharacterDto) =>
      api<void>(buildPath(routes.adminIdentity.unlinkCharacter.path, { characterId: c.id }), {
        method: 'DELETE',
      }),
    onSuccess: (_, c) => {
      void queryClient.invalidateQueries({ queryKey: adminCharactersKey });
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      toast({ title: `${c.name} unlinked`, tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not unlink', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });

  const all = characters.data ?? [];
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? all.filter((c) =>
        [c.name, c.accountName, groups.name(c.corporationId), groups.name(c.allianceId)].some((s) =>
          s?.toLowerCase().includes(needle),
        ),
      )
    : all;
  const shown = matching.slice(0, LIMIT);

  return (
    <Card>
      <CardHeader
        title="Characters"
        description="Every EVE character linked to an account here. Unlinking takes it off the account; its owner can link it again."
      />
      {all.length > 0 && (
        <CardBody>
          <Input
            size="sm"
            icon={<Search />}
            placeholder="Filter by character, person, corporation or alliance"
            aria-label="Filter characters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </CardBody>
      )}
      <CardBody flush>
        {characters.isPending ? (
          <SkeletonRows count={3} />
        ) : characters.isError ? (
          <ErrorState compact error={characters.error} onRetry={() => void characters.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={<UserRound />}
            title={all.length === 0 ? 'No characters yet' : 'No character matches'}
            description={all.length === 0 ? 'Characters people link show up here.' : 'Try another name.'}
          />
        ) : (
          <ul className={styles.list} aria-label="Characters">
            {shown.map((c) => {
              const corp = groups.name(c.corporationId);
              const alliance = groups.name(c.allianceId);
              return (
                <li key={c.id} className={`${styles.item} ${styles.itemCenter}`}>
                  <CharacterAvatar id={c.id} name={c.name} size={32} />
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {c.name}
                      {!c.tokenValid && (
                        <Badge
                          tone="warning"
                          dot
                          title="Its owner has to sign in with it again before it can be tracked."
                        >
                          Token expired
                        </Badge>
                      )}
                    </div>
                    <div className={styles.rowMeta}>
                      {[
                        corp ?? (groups.isPending ? '…' : `Corporation ${c.corporationId}`),
                        alliance ?? (c.allianceId && !groups.isPending ? `Alliance ${c.allianceId}` : null),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className={styles.rowMeta}>
                      {c.accountName ?? 'Unknown account'} · linked {relativeTime(c.linkedAt)}
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <Button size="sm" onClick={() => setUnlinking(c)}>
                      Unlink…
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {matching.length > shown.length && (
          <p className={styles.hint} style={{ padding: 'var(--dbk-space-3) var(--dbk-space-4)' }}>
            Showing {shown.length} of {matching.length}. Filter to find the rest.
          </p>
        )}
      </CardBody>
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={`Unlink ${unlinking?.name ?? ''}?`}
        description={`It comes off ${unlinking?.accountName ?? 'its account'} and stops being tracked. Its owner can link it again; to keep someone out, disable their account instead.`}
        confirmLabel="Unlink character"
        tone="danger"
        onConfirm={() => unlinking && unlink.mutateAsync(unlinking)}
      />
    </Card>
  );
}
