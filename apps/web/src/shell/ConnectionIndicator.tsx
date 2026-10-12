'use client';

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

/** Live / Connecting / Offline: the state of the one WebSocket, and its round trip while live. */
export function ConnectionIndicator() {
  const status = useConnectionStatus();
  const latency = useLatency();
  const s = STATUS[status];
  const live = status === 'open';
  const hint = live && latency !== null ? `${s.hint} Round trip ${latency} ms.` : s.hint;
  return (
    <Tooltip content={hint}>
      <span
        className={styles.connection}
        role="status"
        aria-label={`Realtime: ${s.label}${live && latency !== null ? `, ${latency} ms` : ''}`}
        tabIndex={0}
      >
        <StatusDot color={live ? latencyColor(latency) : s.color} pulse={live} />
        <span className={styles.connectionLabel}>{s.label}</span>
      </span>
    </Tooltip>
  );
}
