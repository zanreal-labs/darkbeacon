import type { CSSProperties } from 'react';
import { Orbit } from 'lucide-react';
import {
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  wormholeDestination,
  type WormholeDestination,
  type WormholeEffect,
} from '@darkbeacon/shared';
import { cssVar, type TokenName } from '@darkbeacon/theme-sdk';
import { cx } from '../ui';
import styles from './WormholeFacts.module.css';

/** Colour of a destination: the same tokens as the class labels of the systems it leads to. */
export function destinationToken(destination: WormholeDestination | null): TokenName {
  switch (destination) {
    case 'hs':
      return 'security-high';
    case 'ls':
      return 'security-low';
    case 'ns':
      return 'security-null';
    case null:
      return 'color-text-muted';
    default:
      return destination.startsWith('c') && destination.length === 2
        ? 'security-wormhole'
        : 'security-special';
  }
}

/** Static wormholes as compact chips, "D845 HS", coloured by where they lead. */
export function StaticChips({
  statics,
  size = 'node',
  className,
}: {
  statics: readonly string[];
  size?: 'node' | 'panel';
  className?: string;
}) {
  if (statics.length === 0) return null;
  return (
    <ul className={cx(styles.statics, className)} data-size={size} aria-label="Statics">
      {statics.map((type) => {
        const to = wormholeDestination(type);
        const where = to ? WORMHOLE_DESTINATION_LABEL[to] : null;
        return (
          <li
            key={type}
            className={styles.static}
            style={{ '--static-color': cssVar(destinationToken(to)) } as CSSProperties}
            title={where ? `Static ${type} to ${where}` : `Static ${type}`}
          >
            <span className={styles.code}>{type}</span>
            {where && <span className={styles.to}>{where}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The system's wormhole effect: an icon and its name, with what it changes as the tooltip. */
export function EffectBadge({ effect, className }: { effect: WormholeEffect | null; className?: string }) {
  if (!effect) return null;
  const { name, summary } = WORMHOLE_EFFECTS[effect];
  return (
    <span className={cx(styles.effect, className)} data-effect={effect} title={`${name}: ${summary}`}>
      <Orbit aria-hidden />
      {name}
    </span>
  );
}
