'use client';

import { useMapPeople } from '../lib/presence';
import { useConnectionStatus } from '../lib/RealtimeProvider';
import { StatusDot, Tooltip } from '../ui';
import styles from './AppShell.module.css';

const STATUS = {
  open: { label: 'Live', color: 'var(--dbk-color-success)', hint: 'Changes from others appear instantly.' },
  connecting: { label: 'Connecting', color: 'var(--dbk-color-warning)', hint: 'Reconnecting to the server…' },
  closed: {
    label: 'Offline',
    color: 'var(--dbk-color-danger)',
    hint: 'Not connected. Retrying in the background.',
  },
} as const;

/** "Alice, Bob and you": who else is here, for the tooltip. */
function whoText(others: readonly string[]): string {
  if (others.length === 0) return 'Only you are on this map.';
  const shown = others.slice(0, 6);
  const rest = others.length - shown.length;
  return `${[...shown, ...(rest > 0 ? [`${rest} more`] : [])].join(', ')} and you are on this map.`;
}

/** Live / Connecting / Offline: the state of the one WebSocket; on a map, how many are on it. */
export function ConnectionIndicator() {
  const status = useConnectionStatus();
  const people = useMapPeople();
  const s = STATUS[status];
  const onMap = status === 'open' && people !== null;
  return (
    <Tooltip
      content={
        onMap ? (
          <>
            {s.hint}
            <br />
            {whoText(people.others)}
          </>
        ) : (
          s.hint
        )
      }
    >
      <span className={styles.connection} role="status" aria-label={`Realtime: ${s.label}`} tabIndex={0}>
        <StatusDot color={s.color} pulse={status === 'open'} />
        <span className={styles.connectionLabel}>
          {s.label}
          {onMap && <span data-map-people={people.count}> · {people.count} on this map</span>}
        </span>
      </span>
    </Tooltip>
  );
}
