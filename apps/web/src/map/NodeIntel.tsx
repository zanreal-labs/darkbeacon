'use client';

import type { CSSProperties } from 'react';
import { Skull, Sparkle } from 'lucide-react';
import { killHeat, type StandingTone, type SystemIntelDto, type WormholeEffect } from '@darkbeacon/shared';
import { cssVar, type TokenName } from '@darkbeacon/theme-sdk';
import { ago, formatIsk, groupLabel, groupOf, useMapKills } from '../lib/intel';
import { Tooltip } from '../ui';
import { STANDING_COLOR, STANDING_LABEL } from './nodeFacts';
import styles from './NodeIntel.module.css';

/** The kills of the last hour on the node, with the killmails behind it on hover. */
export function NodeKills({
  mapId,
  solarSystemId,
  kills,
  list = true,
}: {
  mapId: string;
  solarSystemId: number;
  kills: number;
  /** List the killmails on hover (needs map access; public views show the count alone). */
  list?: boolean;
}) {
  if (kills <= 0) return null;
  const heat = killHeat(kills);
  return (
    <Tooltip
      side="bottom"
      align="end"
      content={
        list ? (
          <NodeKillList mapId={mapId} solarSystemId={solarSystemId} count={kills} />
        ) : (
          `${kills} kill${kills === 1 ? '' : 's'} in the last hour`
        )
      }
    >
      <button
        type="button"
        className={`${styles.kills} nodrag nopan`}
        data-heat={heat}
        aria-label={`${kills} kill${kills === 1 ? '' : 's'} in the last hour`}
        onClick={(e) => e.stopPropagation()}
      >
        <Skull aria-hidden />
        {kills}
      </button>
    </Tooltip>
  );
}

function NodeKillList({
  mapId,
  solarSystemId,
  count,
}: {
  mapId: string;
  solarSystemId: number;
  count: number;
}) {
  const kills = useMapKills(mapId, { hours: 1, systems: [solarSystemId], limit: Math.min(count, 10) });
  const list = kills.data?.kills ?? [];
  return (
    <div className={styles.killList}>
      <p className={styles.killListTitle}>
        {count} kill{count === 1 ? '' : 's'} in the last hour
      </p>
      {kills.isLoading && <p className={styles.killListMuted}>Loading killmails…</p>}
      {!kills.isLoading && list.length === 0 && (
        <p className={styles.killListMuted}>ESI's hourly count; zKillboard has no killmails for it yet.</p>
      )}
      {!kills.isLoading && list.length > 0 && list.length < Math.min(count, 10) && (
        <p className={styles.killListMuted}>
          ESI counts {count} in its last hour; zKillboard has {list.length} of them.
        </p>
      )}
      <ul>
        {list.map((k) => (
          <li key={k.id}>
            <span className={styles.killTime}>{ago(k.time)}</span>
            <span className={styles.killShip}>{k.victim.ship?.name ?? 'Ship'}</span>
            <span className={styles.killGroup}>{groupLabel(groupOf(k.victim), '')}</span>
            <span className={styles.killValue}>{formatIsk(k.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A standing as the game tags it: a small square in the game colour with a white plus (+5, +10),
 * minus (-5, -10) or equals sign (neutral), next to a name. The name keeps its own colour, since
 * the game's dark blue and red are not readable as text on a dark panel.
 */
export function StandingTag({ standing, className }: { standing: StandingTone; className?: string }) {
  const sign = standing === 'excellent' || standing === 'good' ? '+' : standing === 'neutral' ? '=' : '−';
  return (
    <span
      className={className ? `${styles.standingTag} ${className}` : styles.standingTag}
      data-standing={standing}
      style={{ background: cssVar(STANDING_COLOR[standing]) }}
      role="img"
      aria-label={`Standing ${STANDING_LABEL[standing]}`}
      title={`Your standing: ${STANDING_LABEL[standing]}`}
    >
      {sign}
    </span>
  );
}

/**
 * Who holds the system, as a chip below the node's right edge: the alliance ticker `[TICKER]`, the
 * chip filled with the game colour of the viewer's standing towards it in white text (neutral:
 * plain), or a faction's short name. `className` places and frames it like the node's other chips.
 */
export function NodeSovereignty({
  intel,
  standing,
  className,
}: {
  intel: SystemIntelDto | undefined;
  standing?: StandingTone;
  className?: string;
}) {
  const sov = intel?.sovereignty;
  if (!sov) return null;
  const faction = sov.kind === 'faction';
  const label = faction
    ? (sov.holder.ticker ?? sov.holder.name)
    : sov.holder.ticker
      ? `[${sov.holder.ticker}]`
      : null;
  if (!label) return null;
  const title = faction
    ? `Faction space: ${sov.holder.name ?? label}`
    : `Sovereignty: ${sov.holder.name ?? 'an alliance'}${sov.holder.ticker ? ` [${sov.holder.ticker}]` : ''}`;
  const coloured = standing && standing !== 'neutral';
  const style = coloured ? ({ '--sov-color': cssVar(STANDING_COLOR[standing]) } as CSSProperties) : undefined;
  return (
    <span
      className={className ? `${styles.sov} ${className}` : styles.sov}
      data-kind={sov.kind}
      data-standing={standing}
      style={style}
      title={coloured ? `${title}\nYour standing: ${STANDING_LABEL[standing]}` : title}
    >
      {label}
    </span>
  );
}

const EFFECT_TOKEN: Record<WormholeEffect, TokenName> = {
  blackHole: 'effect-black-hole',
  cataclysmicVariable: 'effect-cataclysmic-variable',
  magnetar: 'effect-magnetar',
  pulsar: 'effect-pulsar',
  redGiant: 'effect-red-giant',
  wolfRayet: 'effect-wolf-rayet',
};

/** A small square in the effect's colour next to the name (the name is in the node's tooltip). */
export function EffectDot({ effect }: { effect: WormholeEffect | null | undefined }) {
  if (!effect) return null;
  return (
    <span
      className={styles.effect}
      data-effect={effect}
      style={{ background: cssVar(EFFECT_TOKEN[effect]) }}
      aria-hidden
    />
  );
}

/** A shattered system (the SDE's shattered overlay): a small muted star after the name. */
export function ShatteredMark({ shattered }: { shattered: boolean | undefined }) {
  if (!shattered) return null;
  return (
    <span className={styles.shattered} title="Shattered system" data-shattered>
      <Sparkle aria-label="Shattered" />
    </span>
  );
}
