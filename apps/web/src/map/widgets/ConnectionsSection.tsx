'use client';

import { Lock, LockOpen } from 'lucide-react';
import {
  LIFETIME_MARK_HOURS,
  LifetimeMark,
  type ConnectionDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
import { IconButton } from '../../ui';
import type { MapStore } from '../useMapStore';
import { InlineText } from './InlineText';
import styles from './widgets.module.css';

const TYPE_NAME = { wormhole: 'Wormhole', gate: 'Stargate', bridge: 'Jump bridge' } as const;
const HOUR = 3_600_000;

/** "less than 16 h left, until ~21:40" (local time), or null without a mark. */
export function lifetimeText(c: Pick<ConnectionDto, 'lifetime'>, now = Date.now()): string | null {
  if (!c.lifetime) return null;
  const until = c.lifetime.at + LIFETIME_MARK_HOURS[c.lifetime.mark] * HOUR;
  const at = new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return until <= now
    ? `was under ${c.lifetime.mark} left, gone by now`
    : `under ${c.lifetime.mark} left, until ~${at}`;
}

interface Props {
  solarSystemId: number;
  connections: Map<string, ConnectionDto>;
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
  store: Pick<MapStore, 'updateConnection'>;
  onSelectSystem(solarSystemId: number): void;
}

/**
 * The connections of the selected system: where each leads, its lifetime mark, its note (members
 * edit it) and its lock (a padlock managers toggle; a locked connection is changed by managers
 * only).
 */
export function ConnectionsSection({
  solarSystemId,
  connections,
  universe,
  can,
  store,
  onSelectSystem,
}: Props) {
  const mine = [...connections.values()]
    .filter((c) => c.source === solarSystemId || c.target === solarSystemId)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (mine.length === 0) return <p className={styles.empty}>No connections yet.</p>;
  return (
    <ul className={styles.connections} aria-label="Connections">
      {mine.map((c) => {
        const other = c.source === solarSystemId ? c.target : c.source;
        const name = universe.get(other)?.name ?? '…';
        const locked = c.locked ?? false;
        const editable = can.edit && (!locked || can.manage);
        const lifetime = lifetimeText(c);
        const facts: { text: string; tone?: 'warning' | 'danger' }[] = [
          { text: TYPE_NAME[c.type] },
          ...(c.timeStatus === 'eol' ? [{ text: 'EOL', tone: 'danger' as const }] : []),
          ...(c.massStatus === 'critical'
            ? [{ text: 'crit', tone: 'danger' as const }]
            : c.massStatus === 'reduced'
              ? [{ text: 'reduced', tone: 'warning' as const }]
              : []),
        ];
        return (
          <li key={c.id} className={styles.connectionRow} data-locked={locked || undefined}>
            <div className={styles.connectionHead}>
              <button
                type="button"
                className={styles.connectionName}
                title={`Select ${name}`}
                onClick={() => onSelectSystem(other)}
              >
                {name}
              </button>
              <span className={styles.connectionFacts}>
                {facts.map((f) => (
                  <span key={f.text} data-tone={f.tone}>
                    {f.text}
                  </span>
                ))}
              </span>
              {c.type === 'wormhole' && editable ? (
                <select
                  className={`${styles.inlineSelect} ${styles.lifetimeSelect}`}
                  aria-label={`Lifetime left of the connection to ${name}`}
                  title={lifetime ?? 'Lifetime left: not marked'}
                  value={c.lifetime?.mark ?? ''}
                  onChange={(e) =>
                    void store.updateConnection(c.id, {
                      lifetime: e.target.value === '' ? null : (e.target.value as LifetimeMark),
                    })
                  }
                >
                  <option value="">Life: –</option>
                  {LifetimeMark.options.map((mark) => (
                    <option key={mark} value={mark}>
                      &lt;{mark} left
                    </option>
                  ))}
                </select>
              ) : (
                lifetime && <span className={styles.connectionFacts}>{lifetime}</span>
              )}
              {can.manage ? (
                <IconButton
                  size="sm"
                  className={styles.lockButton}
                  aria-pressed={locked}
                  label={locked ? `Unlock the connection to ${name}` : `Lock the connection to ${name}`}
                  icon={locked ? <Lock /> : <LockOpen />}
                  onClick={() => void store.updateConnection(c.id, { locked: !locked })}
                />
              ) : (
                locked && (
                  <Lock
                    className={styles.lockIcon}
                    aria-label="Locked: a map manager can change it"
                    role="img"
                  />
                )
              )}
            </div>
            {editable ? (
              <InlineText
                label={`Note on the connection to ${name}`}
                value={c.note ?? ''}
                placeholder="Note"
                maxLength={2000}
                activity={{ verb: 'editing', target: { kind: 'connection', id: c.id }, label: 'note' }}
                onCommit={(note) => void store.updateConnection(c.id, { note: note ?? '' })}
              />
            ) : (
              c.note && <span className={styles.connectionFacts}>{c.note}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
