'use client';

import { useQuery } from '@tanstack/react-query';
import {
  routes,
  WORMHOLE_DESTINATION_LABEL,
  wormholeDestination,
  type SignatureDestination,
  type WormholeCatalogDto,
  type WormholeTypeDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { api } from '../../lib/api';
import { destinationToken } from '../WormholeFacts';
import { destinationClasses, SHORT_DESTINATION } from './facts';
import styles from './signatures.module.css';

/** Every wormhole type with its mass and lifetime, loaded once per session. */
export function useWormholeCatalog() {
  const query = useQuery({
    queryKey: ['universe', 'wormholes'],
    queryFn: () => api<WormholeCatalogDto>(routes.universe.wormholes.path),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const byCode = new Map((query.data?.types ?? []).map((t) => [t.code, t]));
  return { ...query, byCode };
}

/** Kilograms as tons: `2 000 000 t`, `1.5M t`. */
export function tons(kg: number | null): string {
  if (kg === null) return '—';
  const t = kg / 1000;
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(t % 1_000_000 ? 1 : 0)}M t`;
  return `${Math.round(t).toLocaleString('en-US').replaceAll(',', ' ')} t`;
}

/** "Total 2 000 000 t · jump 375 000 t · 24 h · regen …" for a type's tooltip. */
export function typeFacts(type: WormholeTypeDto | undefined): string | undefined {
  if (!type || type.code === 'K162') return type ? 'The exit side of another hole' : undefined;
  return [
    `Total mass ${tons(type.totalMass)}`,
    `jump mass ${tons(type.maxJumpMass)}`,
    type.lifetimeHours ? `lifetime ${type.lifetimeHours} h` : null,
    type.massRegeneration ? `mass regen ${tons(type.massRegeneration)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A wormhole type as players write it: code and its destination in the destination's colour. */
export function TypeLabel({
  code,
  destination,
  title,
}: {
  code: string;
  /** For K162 and C729: where the pilot said it leads. */
  destination?: SignatureDestination | null;
  title?: string;
}) {
  const fixed = code.toUpperCase() === 'C729' ? null : wormholeDestination(code);
  const parts = fixed ? [fixed] : destination ? destinationClasses(destination) : [];
  return (
    <span className={styles.typeLabel} title={title}>
      <span className={styles.typeCode}>{code}</span>
      {parts.length > 0 && (
        <span className={styles.typeDest}>
          {fixed ? (
            <span style={{ color: cssVar(destinationToken(fixed)) }}>
              {WORMHOLE_DESTINATION_LABEL[fixed]}
            </span>
          ) : (
            <span style={{ color: cssVar(destinationToken(parts[0]!)) }}>
              {SHORT_DESTINATION[destination!]}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
