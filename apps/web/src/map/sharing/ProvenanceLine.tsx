'use client';

import { useEffect, useState } from 'react';
import type { MapSourceDto, ProvenanceDto } from '@darkbeacon/shared';
import { relativeTime } from '../../lib/time';
import styles from './sharing.module.css';

const name = (sources: readonly MapSourceDto[], id: string) => {
  const source = sources.find((s) => s.id === id);
  if (!source) return 'a map that left';
  return source.instanceName ? `${source.name} (${source.instanceName})` : source.name;
};

/** "Corp A chain, Corp B chain · updated by Corp B chain 4 min ago" (provenance on merged maps). */
export function provenanceText(
  provenance: ProvenanceDto,
  sources: readonly MapSourceDto[],
  now = Date.now(),
) {
  const holders = provenance.sources.map((id) => name(sources, id));
  const when = relativeTime(provenance.updatedAt, now);
  const by = name(sources, provenance.updatedBy);
  const from = holders.length > 1 ? `${holders.join(', ')} · ` : '';
  return `${from}updated by ${by} ${when}${provenance.writable ? '' : ' · read-only'}`;
}

/**
 * One quiet line under a merged object's details: which maps hold it and whose change is the
 * newest. Nothing of it is drawn on the canvas.
 */
export function ProvenanceLine({
  provenance,
  sources,
}: {
  provenance: ProvenanceDto | undefined;
  sources: readonly MapSourceDto[] | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!provenance || !sources) return null;
  return (
    <p className={styles.provenance} data-testid="provenance">
      {provenanceText(provenance, sources, now)}
    </p>
  );
}
