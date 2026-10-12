'use client';

import type { EveServerStatusDto } from '@darkbeacon/shared';
import { useEveStatus } from '../lib/characters';
import { relativeTime } from '../lib/time';
import { StatusDot, Tooltip } from '../ui';
import styles from './StatusBits.module.css';

const players = new Intl.NumberFormat('en-US');

/** Words and colour for Tranquility's state. */
export function describeTq(status: EveServerStatusDto | undefined): {
  label: string;
  color: string;
  hint: string;
} {
  if (!status || status.online === null)
    return {
      label: 'TQ',
      color: 'var(--dbk-color-text-subtle)',
      hint: 'Tranquility status unknown: ESI did not answer.',
    };
  if (status.vip)
    return {
      label: 'TQ VIP',
      color: 'var(--dbk-color-warning)',
      hint: 'Tranquility only lets developers in (downtime). Tracking waits.',
    };
  if (!status.online)
    return {
      label: 'TQ down',
      color: 'var(--dbk-color-danger)',
      hint: 'Tranquility is down (downtime). Tracking waits until it is back.',
    };
  const started = status.startedAt ? ` Up since ${relativeTime(status.startedAt)}.` : '';
  return {
    label: players.format(status.players ?? 0),
    color: 'var(--dbk-color-success)',
    hint: `Tranquility is online with ${players.format(status.players ?? 0)} players.${started}`,
  };
}

/** Tranquility in the top bar: player count while up, VIP or down around downtime. */
export function EveStatus() {
  const status = useEveStatus();
  const tq = describeTq(status.data);
  return (
    <Tooltip content={tq.hint}>
      <span
        className={styles.tq}
        // Nothing to worry about: online, or simply unknown.
        data-quiet={status.data?.online !== false || undefined}
        role="status"
        aria-label={`EVE server: ${tq.hint}`}
        tabIndex={0}
      >
        <StatusDot color={tq.color} />
        <span className={styles.tqLabel}>
          <span className={styles.tqName}>TQ</span>
          {tq.label !== 'TQ' && <span>{tq.label.replace(/^TQ /, '')}</span>}
        </span>
      </span>
    </Tooltip>
  );
}
