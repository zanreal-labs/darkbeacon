'use client';

import { Ban, Flag, MapPin, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { formatLy } from './format';
import { distanceLy, hasStation, noCynoReason, securityColor, securityLabel, type StarModel } from './model';
import styles from './jump.module.css';

/**
 * A system under the pointer (a preview) or clicked (pinned, with its actions): name, security,
 * region, how far it is from the start and whether a jump can land there.
 */
export function SystemCard({
  model,
  system,
  at,
  pinned,
  origin,
  rangeLy,
  avoided,
  chainName,
  onClose,
  onOrigin,
  onDestination,
  onAvoid,
}: {
  model: StarModel;
  system: number;
  at: { x: number; y: number };
  pinned: boolean;
  origin: number | null;
  rangeLy: number;
  avoided: boolean;
  /** The viewer's chain reaches this system through a wormhole. */
  chainName: string | null;
  onClose(): void;
  onOrigin(): void;
  onDestination(): void;
  onAvoid(): void;
}) {
  const security = model.security[system]!;
  const noCyno = noCynoReason(model, system);
  const distance = origin !== null && origin !== system ? distanceLy(model, origin, system) : null;
  return (
    <div
      className={styles.card}
      data-pinned={pinned || undefined}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={model.names[system]}
      // Next to the pointer, but never past the right or bottom edge.
      style={{
        left: `max(8px, min(${at.x + 14}px, calc(100% - 336px)))`,
        top: `max(8px, min(${at.y + 14}px, calc(100% - ${pinned ? 200 : 120}px)))`,
      }}
    >
      <div className={styles.cardHead}>
        <span className={styles.secPill} style={{ background: securityColor(security) }}>
          {securityLabel(security)}
        </span>
        <strong className={styles.cardName}>{model.names[system]}</strong>
        {pinned && (
          <IconButton
            size="sm"
            variant="ghost"
            label="Close"
            icon={<X />}
            tooltip={false}
            onClick={onClose}
          />
        )}
      </div>
      <div className={styles.cardMeta}>
        {model.regionNames[model.regionOf[system]!]}
        {hasStation(model, system) && ' · NPC station'}
      </div>
      {distance !== null && (
        <div className={styles.cardLine}>
          {formatLy(distance)} from {model.names[origin!]}
          {noCyno === null && (
            <span data-tone={distance <= rangeLy ? 'ok' : 'far'}>
              {distance <= rangeLy ? ' · in range' : ' · out of range'}
            </span>
          )}
        </div>
      )}
      {chainName && <div className={styles.cardChain}>{chainName} has a wormhole here</div>}
      {noCyno && <div className={styles.cardWarn}>{noCyno}</div>}
      {pinned && (
        <div className={styles.cardActions}>
          <Button size="sm" icon={<MapPin />} onClick={onOrigin}>
            Start here
          </Button>
          <Button size="sm" icon={<Flag />} onClick={onDestination}>
            Destination
          </Button>
          <Button size="sm" variant="ghost" icon={<Ban />} onClick={onAvoid}>
            {avoided ? 'Stop avoiding' : 'Avoid'}
          </Button>
        </div>
      )}
    </div>
  );
}
