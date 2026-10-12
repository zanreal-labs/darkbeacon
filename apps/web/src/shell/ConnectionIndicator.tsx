'use client';

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

/** Live / Connecting / Offline: the state of the one WebSocket. */
export function ConnectionIndicator() {
  const status = useConnectionStatus();
  const s = STATUS[status];
  return (
    <Tooltip content={s.hint}>
      <span className={styles.connection} role="status" aria-label={`Realtime: ${s.label}`} tabIndex={0}>
        <StatusDot color={s.color} pulse={status === 'open'} />
        <span className={styles.connectionLabel}>{s.label}</span>
      </span>
    </Tooltip>
  );
}
