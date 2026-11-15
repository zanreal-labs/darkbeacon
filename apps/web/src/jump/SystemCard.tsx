'use client';

import { Ban, Building2, Flag, MapPin, X } from 'lucide-react';
import { structureLabel, useKnownStructures } from '../lib/known-structures';
import { Avatar, Button, IconButton } from '../ui';
import { formatLy } from './format';
import { distanceLy, hasStation, noCynoReason, securityColor, securityLabel, type StarModel } from './model';
import styles from './jump.module.css';

/** Stations and structures listed on a pinned card; the rest are counted. */
const SHOWN_DOCKS = 8;

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
  // Where one can dock, once the card is pinned (a passing pointer asks nothing).
  const name = model.names[system]!;
  const known = useKnownStructures([model.ids[system]!], pinned).bySystem.get(model.ids[system]!) ?? [];
  const docks = known.slice(0, SHOWN_DOCKS);
  return (
    <div
      className={styles.card}
      data-pinned={pinned || undefined}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={model.names[system]}
      // Next to the pointer, but never past the right or bottom edge.
      style={{
        left: `max(8px, min(${at.x + 14}px, calc(100% - 336px)))`,
        top: `max(8px, min(${at.y + 14}px, calc(100% - ${pinned ? 200 + docks.length * 20 : 120}px)))`,
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
      {pinned && docks.length > 0 && (
        <ul className={styles.cardDocks} aria-label="Stations and structures">
          {docks.map((d) => (
            <li key={d.id} title={d.name}>
              {d.typeId ? (
                <Avatar
                  src={`https://images.evetech.net/types/${d.typeId}/icon?size=32`}
                  name={d.typeName ?? d.name}
                  size={16}
                  shape="rounded"
                />
              ) : (
                <Building2 aria-hidden />
              )}
              <span>{structureLabel(d, name)}</span>
              {d.owner?.ticker && <em>[{d.owner.ticker}]</em>}
            </li>
          ))}
          {known.length > SHOWN_DOCKS && <li data-more>+{known.length - SHOWN_DOCKS} more</li>}
        </ul>
      )}
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
