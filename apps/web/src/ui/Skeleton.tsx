'use client';

import type { CSSProperties } from 'react';
import styles from './display.module.css';

/** Placeholder block while content loads; size it like the content it stands for. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span className={styles.skeleton} style={{ width, height, borderRadius: radius, ...style }} aria-hidden />
  );
}

/** Skeleton rows matching <Row>: avatar, two lines of text. */
export function SkeletonRows({ count = 3, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <ul className={styles.rows} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.row}>
          {avatar && <Skeleton width={32} height={32} radius={8} />}
          <div className={styles.rowMain}>
            <Skeleton width={`${50 - i * 8}%`} height={12} />
            <Skeleton width={`${30 + i * 6}%`} height={10} />
          </div>
        </li>
      ))}
    </ul>
  );
}
