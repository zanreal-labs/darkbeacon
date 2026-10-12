'use client';

import { useMapPeople } from '../lib/presence';
import { useConnectionStatus, useLatency } from '../lib/RealtimeProvider';
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

/** Round trips up to this feel instant; past `SLOW_MS` changes visibly lag. */
const FAST_MS = 150;
const SLOW_MS = 400;

/** The Live dot's colour while connected: green when quick, amber when slow, red when lagging. */
export function latencyColor(ms: number | null): string {
  if (ms === null || ms <= FAST_MS) return STATUS.open.color;
  return ms <= SLOW_MS ? 'var(--dbk-color-warning)' : 'var(--dbk-color-danger)';
}

/** "Alice, Bob and you": who else is here, for the tooltip. */
function whoText(others: readonly string[]): string {
  if (others.length === 0) return 'Only you are on this map.';
  const shown = others.slice(0, 6);
  const rest = others.length - shown.length;
  return `${[...shown, ...(rest > 0 ? [`${rest} more`] : [])].join(', ')} and you are on this map.`;
}

/**
 * Live / Connecting / Offline: the state of the one WebSocket, its round trip while live (the
 * dot's colour), and on a map how many are on it.
 */
export function ConnectionIndicator() {
  const status = useConnectionStatus();
  const latency = useLatency();
  const people = useMapPeople();
  const s = STATUS[status];
  const live = status === 'open';
  const onMap = live && people !== null;
  const hint = live && latency !== null ? `${s.hint} Round trip ${latency} ms.` : s.hint;
  return (
    <Tooltip
      content={
        onMap ? (
          <>
            {hint}
            <br />
            {whoText(people.others)}
          </>
        ) : (
          hint
        )
      }
    >
      <span
        className={styles.connection}
        role="status"
        aria-label={`Realtime: ${s.label}${live && latency !== null ? `, ${latency} ms` : ''}`}
        tabIndex={0}
      >
        <StatusDot color={live ? latencyColor(latency) : s.color} pulse={live} />
        <span className={styles.connectionLabel}>
          {s.label}
          {onMap && <span data-map-people={people.count}> · {people.count} on this map</span>}
        </span>
      </span>
    </Tooltip>
  );
}
