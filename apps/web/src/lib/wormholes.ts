'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HULL_CLASS_LABEL,
  routes,
  WORMHOLE_DESTINATION_LABEL,
  type WormholeCatalogDto,
  type WormholeTypeDto,
} from '@darkbeacon/shared';
import { api } from './api';

/** Every wormhole type by code (static game data: loaded once per page). */
export function useWormholeTypes(): ReadonlyMap<string, WormholeTypeDto> {
  const query = useQuery({
    queryKey: ['universe', 'wormholes'],
    queryFn: () => api<WormholeCatalogDto>(routes.universe.wormholes.path),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return useMemo(() => new Map((query.data?.types ?? []).map((t) => [t.code, t])), [query.data]);
}

/** Mass in kg as people write it: "2,000M kg", "375M kg", "20M kg". */
export function massText(kg: number): string {
  return `${Math.round(kg / 1e6).toLocaleString('en-US')}M kg`;
}

/**
 * What a static is, in one line each: where it leads, its mass (total and per jump, with the
 * heaviest hull class that fits), its lifetime. Without catalogue data just where it leads.
 */
export function staticFacts(code: string, type: WormholeTypeDto | undefined): string {
  const where = type?.destination ? WORMHOLE_DESTINATION_LABEL[type.destination] : null;
  const lines = [where ? `Static ${code} to ${where}` : `Static ${code}`];
  if (type?.totalMass) lines.push(`Mass: ${massText(type.totalMass)} in total`);
  if (type?.maxJumpMass) {
    const biggest = type.fits.at(-1);
    lines.push(
      `Per jump: up to ${massText(type.maxJumpMass)}${biggest ? ` (${HULL_CLASS_LABEL[biggest]} fit)` : ''}`,
    );
  }
  if (type?.lifetimeHours) lines.push(`Lifetime: ${type.lifetimeHours} h`);
  return lines.join('\n');
}
