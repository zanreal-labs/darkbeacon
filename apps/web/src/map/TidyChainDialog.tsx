'use client';

import { useQuery } from '@tanstack/react-query';
import { buildPath, routes, type TidyChainDto, type TidyChainRequest } from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { ConfirmDialog, useToast } from '../ui';

const tidy = (mapId: string, apply: boolean) =>
  api<TidyChainDto>(buildPath(routes.systems.tidy.path, { mapId }), {
    method: 'POST',
    json: { apply } satisfies TidyChainRequest,
  });

const list = (names: string[]) =>
  names.length <= 6 ? names.join(', ') : `${names.slice(0, 6).join(', ')} and ${names.length - 6} more`;

/**
 * Tidying the chain, map managers only: what goes and what moves is shown first (a preview the
 * server works out), then one click does it. Off the wormhole chain are the trips through known
 * space a cyno, a bridge or gates left on the map.
 */
export function TidyChainDialog({
  mapId,
  open,
  onOpenChange,
  nameOf,
}: {
  mapId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  nameOf(solarSystemId: number): string;
}) {
  const toast = useToast();
  const preview = useQuery({
    queryKey: ['maps', mapId, 'tidy-preview'],
    queryFn: () => tidy(mapId, false),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const p = preview.data;
  const description = preview.isPending
    ? 'Working out what is off the chain…'
    : preview.error
      ? preview.error instanceof ApiError
        ? preview.error.message
        : 'The server did not answer'
      : p && p.hidden.length === 0 && p.moved === 0
        ? 'The chain is already in order: nothing off it, nothing to move.'
        : [
            p && p.hidden.length > 0
              ? `Hides ${p.hidden.length} ${p.hidden.length === 1 ? 'system' : 'systems'} off the wormhole chain (cyno, bridge and gate trips, locked ones too): ${list(p.hidden.map(nameOf))}. Their notes and signatures are kept.`
              : null,
            p && p.moved > 0
              ? `Lays the chain out again from home: ${p.moved} ${p.moved === 1 ? 'system moves' : 'systems move'}, each beside the one it hangs off.`
              : null,
            p && p.kept.length > 0 ? `Kept for their rally pings: ${list(p.kept.map(nameOf))}.` : null,
          ]
            .filter(Boolean)
            .join(' ');
  const nothing = !p || (p.hidden.length === 0 && p.moved === 0);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tidy the chain"
      description={description}
      confirmLabel={nothing ? 'Close' : 'Tidy'}
      tone={p && p.hidden.length > 0 ? 'danger' : 'default'}
      onConfirm={async () => {
        if (nothing) return;
        try {
          const done = await tidy(mapId, true);
          toast({
            tone: 'success',
            title: 'Chain tidied',
            description: `${done.hidden.length} hidden, ${done.moved} moved.`,
          });
        } catch (error) {
          toast({
            tone: 'danger',
            title: 'Could not tidy the chain',
            description: error instanceof ApiError ? error.message : 'The server did not answer',
          });
          throw error;
        }
      }}
    />
  );
}
