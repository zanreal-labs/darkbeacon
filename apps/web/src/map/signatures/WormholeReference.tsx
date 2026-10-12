'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  SPAWN_AREA_LABEL,
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_SPAWNS,
  type WormholeDestination,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Dialog, DialogContent, Input, Skeleton } from '../../ui';
import { destinationToken } from '../WormholeFacts';
import { tons, TypeLabel, useWormholeCatalog } from './catalog';
import styles from './signatures.module.css';

const areaLabel = (area: string) =>
  SPAWN_AREA_LABEL[area] ?? WORMHOLE_DESTINATION_LABEL[area as WormholeDestination] ?? area;
const areaColor = (area: string) =>
  area in WORMHOLE_DESTINATION_LABEL ? cssVar(destinationToken(area as WormholeDestination)) : undefined;

/**
 * Every wormhole type: where it leads and spawns, lifetime, mass, how it respawns. Searchable by
 * any of it (`C5`, `static`, `B274`, `16`).
 */
export function WormholeReference({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const catalog = useWormholeCatalog();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog.data?.types ?? [])
      .filter((t) => t.code !== 'K162')
      .map((t) => ({ type: t, spawns: WORMHOLE_SPAWNS[t.code] }))
      .filter(({ type: t, spawns }) => {
        if (!q) return true;
        const text = [
          t.code,
          t.destination,
          t.destination ? WORMHOLE_DESTINATION_LABEL[t.destination] : '',
          ...(spawns?.spawnsIn.flatMap((a) => [a, areaLabel(a)]) ?? []),
          ...(spawns?.respawn ?? []),
          t.lifetimeHours,
          t.totalMass,
          t.maxJumpMass,
        ]
          .join(' ')
          .toLowerCase();
        return text.includes(q);
      });
  }, [catalog.data, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Wormhole types"
        description="Every wormhole type and where it spawns."
        width={860}
      >
        <div className={styles.reference}>
          <Input
            aria-label="Search wormhole types"
            placeholder="Search: type, class, static, lifetime…"
            icon={<Search />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {catalog.isPending ? (
            <Skeleton height={14} width="60%" />
          ) : (
            <div className={styles.referenceScroll}>
              <table className={styles.referenceTable}>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Spawns in</th>
                    <th scope="col">Lifetime</th>
                    <th scope="col">Total mass</th>
                    <th scope="col">Per jump</th>
                    <th scope="col">Respawn</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ type: t, spawns }) => (
                    <tr key={t.code}>
                      <td>
                        <TypeLabel code={t.code} />
                      </td>
                      <td>
                        <span className={styles.chips}>
                          {spawns?.spawnsIn.map((a) => (
                            <span key={a} className={styles.chip} style={{ color: areaColor(a) }}>
                              {areaLabel(a)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>{t.lifetimeHours ? `${t.lifetimeHours} h` : '—'}</td>
                      <td>{tons(t.totalMass)}</td>
                      <td>{tons(t.maxJumpMass)}</td>
                      <td>
                        <span className={styles.chips}>
                          {spawns?.respawn.map((r) => (
                            <span key={r} className={styles.chip} data-respawn={r}>
                              {r}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
