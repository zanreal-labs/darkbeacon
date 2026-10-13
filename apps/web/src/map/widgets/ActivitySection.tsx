'use client';

import type { CSSProperties } from 'react';
import {
  killHeat,
  standingTone,
  type ActiveGroupDto,
  type ActivityHourDto,
  type KillmailDto,
  type SovereigntyDto,
  type SystemActivityDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import {
  ago,
  groupLabel,
  images,
  useStandings,
  useStandingsQuery,
  useSystemActivity,
  zkill,
} from '../../lib/intel';
import { hereForReturn } from '../../lib/scope-health';
import { eveLinkHref } from '../../shell/AccountMenu';
import { Avatar } from '../../ui';
import styles from './intel.module.css';

function sum(hours: readonly ActivityHourDto[], pick: (h: ActivityHourDto) => number | null): number | null {
  const known = hours.map(pick).filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** Ships and pods destroyed in an hour: ESI's figure, else zKillboard's killmails (wormholes). */
const shipAndPod = (h: ActivityHourDto) =>
  h.shipKills === null ? h.killmails : Math.max(h.shipKills + (h.podKills ?? 0), h.killmails ?? 0);

/** 24 bars, one per hour, oldest left; an hour ESI said nothing about is a gap. */
export function Sparkline({
  hours,
  pick,
  label,
  width = 96,
  height = 20,
}: {
  hours: readonly ActivityHourDto[];
  pick: (h: ActivityHourDto) => number | null;
  label: string;
  width?: number;
  height?: number;
}) {
  const values = hours.map(pick);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const step = width / Math.max(values.length, 1);
  return (
    <svg
      className={styles.spark}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {values.map((v, i) =>
        v === null ? null : (
          <rect
            key={i}
            x={i * step + 0.5}
            y={height - Math.max(1, (v / max) * height)}
            width={Math.max(1, step - 1)}
            height={Math.max(1, (v / max) * height)}
            rx={0.5}
          />
        ),
      )}
    </svg>
  );
}

/**
 * The three EVE hours (UTC) with the most killmails among those known, from three of them on:
 * "18–21". Null when there are too few to say.
 */
export function peakHours(kills: readonly Pick<KillmailDto, 'time'>[]): string | null {
  if (kills.length < 3) return null;
  const perHour = Array.from({ length: 24 }, () => 0);
  for (const k of kills) perHour[new Date(k.time).getUTCHours()]! += 1;
  let best = 0;
  let bestCount = -1;
  for (let h = 0; h < 24; h++) {
    const count = perHour[h]! + perHour[(h + 1) % 24]! + perHour[(h + 2) % 24]!;
    if (count > bestCount) [best, bestCount] = [h, count];
  }
  const pad = (h: number) => String(h % 24).padStart(2, '0');
  return `${pad(best)}–${pad(best + 3)}`;
}

/** Who kills here most: groups with kills in the window, most first. */
export function topKillers(groups: readonly ActiveGroupDto[], count = 4): ActiveGroupDto[] {
  return groups
    .filter((g) => g.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.losses - a.losses)
    .slice(0, count);
}

/** One line under the system's facts: who holds it, with the logo; unclaimed null-sec, the region's holder. */
export function SovereigntyLine({ intel }: { intel: SystemActivityDto['intel'] | undefined }) {
  const sov: SovereigntyDto | null | undefined = intel?.sovereignty;
  const region = intel?.regionHolder;
  if (sov) {
    const faction = sov.kind === 'faction';
    return (
      <p className={styles.holder}>
        <Avatar
          src={faction ? images.corporation(sov.holder.id) : images.alliance(sov.holder.id)}
          name={sov.holder.name ?? '?'}
          size={16}
          shape="rounded"
        />
        <span>
          {faction ? 'Faction space: ' : 'Held by '}
          <a
            href={faction ? zkill.system(intel!.solarSystemId) : zkill.alliance(sov.holder.id)}
            target="_blank"
            rel="noreferrer"
          >
            {sov.holder.name ?? 'an alliance ESI does not name yet'}
          </a>
          {!faction && sov.holder.ticker && <span className={styles.ticker}> [{sov.holder.ticker}]</span>}
          {sov.corporation && (
            <span className={styles.muted}>
              {' '}
              · claimed by {sov.corporation.name ?? 'a corporation'}
              {sov.corporation.ticker && ` [${sov.corporation.ticker}]`}
            </span>
          )}
        </span>
      </p>
    );
  }
  if (region) {
    return (
      <p className={styles.holder}>
        <Avatar
          src={images.alliance(region.holder.id)}
          name={region.holder.name ?? '?'}
          size={16}
          shape="rounded"
        />
        <span>
          Unclaimed; {region.region} is held by{' '}
          <a href={zkill.alliance(region.holder.id)} target="_blank" rel="noreferrer">
            {region.holder.name ?? 'an alliance'}
          </a>
          {region.holder.ticker && <span className={styles.ticker}> [{region.holder.ticker}]</span>}{' '}
          <span className={styles.muted}>
            ({region.held}/{region.total})
          </span>
        </span>
      </p>
    );
  }
  return null;
}

/** A standing's colour for a name or ticker; nothing for neutral. */
export function standingStyle(standing: number | undefined): CSSProperties | undefined {
  const tone = standingTone(standing);
  return tone === 'neutral' ? undefined : { color: cssVar(`standing-${tone}`) };
}

/**
 * The selected system's kill intel in a few lines of numbers: kills in the last hour and day (ships
 * and pods) with NPC kills and jumps where ESI gives them and the day as 24 bars; the last kill and
 * the busiest hours; who kills here most this week, coloured by the viewer's standings; who holds
 * the system. Lines without data are left out.
 */
export function SystemIntel({ mapId, solarSystemId }: { mapId: string; solarSystemId: number }) {
  const activity = useSystemActivity(mapId, solarSystemId);
  const standingsQuery = useStandingsQuery();
  const standings = useStandings();
  const data = activity.data;
  const intel = data?.intel;
  const hours = data?.hours ?? [];
  const day = data ? sum(hours, shipAndPod) : null;
  const heat = intel ? killHeat(intel.kills1h) : 'none';
  const last = intel?.lastKillAt ?? null;
  const lastShip = data?.kills[0]?.victim.ship?.name;
  const peak = data ? peakHours(data.kills) : null;
  const killers = data ? topKillers(data.groups['7d']) : [];
  const anyKills = hours.some((h) => (shipAndPod(h) ?? 0) > 0);
  const held = intel?.sovereignty?.kind === 'alliance';

  return (
    <div className={styles.intel} role="group" aria-label="Kill intel">
      <div className={styles.intelLine}>
        <span className={styles.figure} data-heat={heat}>
          <span className={styles.what}>Kills</span>
          <b aria-label={`${intel?.kills1h ?? 'unknown'} in the last hour`}>{intel?.kills1h ?? '–'}</b>
          <span className={styles.unit}>1h</span>
          <b aria-label={`${day ?? 'unknown'} in the last day`}>{day ?? '–'}</b>
          <span className={styles.unit}>24h</span>
        </span>
        {intel?.npcKills1h != null && (
          <span className={styles.figure}>
            <span className={styles.what}>NPC</span>
            <b>{intel.npcKills1h}</b>
          </span>
        )}
        {intel?.jumps1h != null && (
          <span className={styles.figure}>
            <span className={styles.what}>Jumps</span>
            <b>{intel.jumps1h}</b>
          </span>
        )}
        {anyKills && (
          <Sparkline
            hours={hours}
            pick={shipAndPod}
            label="Kills per hour, last 24 hours"
            width={72}
            height={12}
          />
        )}
      </div>
      {(last !== null || peak) && (
        <div className={styles.intelLine}>
          {last !== null && (
            <span className={styles.figure}>
              <span className={styles.what}>Last kill</span>
              <b>{ago(last)}</b>
              {lastShip && <span className={styles.ship}>{lastShip}</span>}
            </span>
          )}
          {peak && (
            <span className={styles.figure} title="The three EVE hours with the most killmails known">
              <span className={styles.what}>Peak</span>
              <b>{peak}</b>
              <span className={styles.unit}>ET</span>
            </span>
          )}
        </div>
      )}
      {killers.length > 0 && (
        <div className={styles.intelLine}>
          <span className={styles.what} title="Most kills here in the last 7 days">
            7d
          </span>
          <ul className={styles.killers} aria-label="Most kills here, last 7 days">
            {killers.map((g) => (
              <li key={`${g.kind}:${g.entity.id}`}>
                <a
                  href={g.kind === 'alliance' ? zkill.alliance(g.entity.id) : zkill.corporation(g.entity.id)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${g.entity.name ?? groupLabel(g.entity)}: ${g.kills} kill${g.kills === 1 ? '' : 's'}${g.losses ? `, ${g.losses} loss${g.losses === 1 ? '' : 'es'}` : ''}`}
                  style={standingStyle(standings.get(g.entity.id))}
                >
                  {groupLabel(g.entity)}
                </a>
                <b>{g.kills}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SovereigntyLine intel={intel} />
      {held && standingsQuery.data?.missingScopes && (
        <p className={styles.relink}>
          <a
            href={eveLinkHref(hereForReturn())}
            title="Contacts were not asked for when your characters were linked"
          >
            Link your characters again
          </a>{' '}
          for standings
        </p>
      )}
    </div>
  );
}
