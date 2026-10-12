'use client';

import { memo, type CSSProperties } from 'react';
import { useStore, ViewportPortal } from '@xyflow/react';
import type { PresencePeerDto } from '@darkbeacon/shared';
import styles from './presence.module.css';

/**
 * Other people's pointers on the map: an arrow cursor with a name tag in their colour, at the
 * map point they point at. They keep their size at any zoom, like a real cursor, and never
 * catch the pointer.
 */
export const PresenceCursors = memo(function PresenceCursors({
  peers,
}: {
  peers: readonly PresencePeerDto[];
}) {
  const zoom = useStore((s) => s.transform[2]);
  const shown = peers.filter((p) => p.cursor);
  if (shown.length === 0) return null;
  return (
    <ViewportPortal>
      {shown.map((peer) => (
        <div
          key={peer.key}
          className={styles.cursor}
          data-presence-cursor={peer.accountId}
          aria-hidden
          style={
            {
              '--who': `var(--dbk-presence-${peer.color})`,
              transform: `translate(${peer.cursor!.x}px, ${peer.cursor!.y}px) scale(${1 / zoom})`,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 16 20" width={16} height={20} className={styles.arrow}>
            <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" />
          </svg>
          <span className={styles.tag}>{peer.characterName ?? peer.name}</span>
        </div>
      ))}
    </ViewportPortal>
  );
});
