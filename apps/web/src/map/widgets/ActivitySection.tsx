'use client';

import { useState } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import type {
  ActiveGroupDto,
  ActivityHourDto,
  ActivityWindow,
  IntelEntityDto,
  SovereigntyDto,
  SystemActivityDto,
} from '@darkbeacon/shared';
import { evewho, images, useStandingsQuery, useSystemActivity, zkill } from '../../lib/intel';
import { hereForReturn } from '../../lib/scope-health';
import { eveLinkHref } from '../../shell/AccountMenu';
import { track } from '../../lib/telemetry';
import { Avatar, Segmented } from '../../ui';
import styles from './intel.module.css';

const WINDOWS: ActivityWindow[] = ['1h', '24h', '7d'];
const WINDOW_TEXT: Record<ActivityWindow, string> = {
  '1h': 'last hour',
  '24h': 'last day',
  '7d': 'last week',
};

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

/** Logo of a group: alliances and corporations from the image server, rounded squares. */
function GroupLogo({
  kind,
  entity,
  size = 20,
}: {
  kind: 'alliance' | 'corporation';
  entity: IntelEntityDto;
  size?: number;
}) {
  return (
    <Avatar
      src={kind === 'alliance' ? images.alliance(entity.id) : images.corporation(entity.id)}
      name={entity.name ?? entity.ticker ?? '?'}
      size={size}
      shape="rounded"
    />
  );
}

/** The holder line of the system's header, from the Activity data (shared query). */
export function SystemHolder({ mapId, solarSystemId }: { mapId: string; solarSystemId: number }) {
  const activity = useSystemActivity(mapId, solarSystemId);
  const standings = useStandingsQuery();
  const held = activity.data?.intel.sovereignty?.kind === 'alliance';
  return (
    <>
      <SovereigntyLine intel={activity.data?.intel} />
      {held && standings.data?.missingScopes && (
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
    </>
  );
}

/** One line under the system's name: who holds it, with the logo; for unclaimed null-sec the region's holder. */
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

function Group({ group }: { group: ActiveGroupDto }) {
  const { kind, entity } = group;
  const name = entity.name ?? (kind === 'alliance' ? 'An alliance' : 'A corporation');
  return (
    <li className={styles.group}>
      <GroupLogo kind={kind} entity={entity} />
      <span className={styles.groupName}>
        <span className={styles.groupTitle}>
          {name}
          {entity.ticker && <span className={styles.ticker}> [{entity.ticker}]</span>}
        </span>
        <span className={styles.muted}>
          {group.kills} kill{group.kills === 1 ? '' : 's'}
          {group.losses > 0 && ` · ${group.losses} loss${group.losses === 1 ? '' : 'es'}`}
        </span>
      </span>
      <span className={styles.links}>
        <a
          href={kind === 'alliance' ? zkill.alliance(entity.id) : zkill.corporation(entity.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={`${name} on zKillboard`}
          title="zKillboard"
        >
          zKill
          <ArrowUpRight aria-hidden />
        </a>
        <a
          href={kind === 'alliance' ? evewho.alliance(entity.id) : evewho.corporation(entity.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={`${name} on EVE Who`}
          title="EVE Who"
        >
          Who
          <ArrowUpRight aria-hidden />
        </a>
      </span>
    </li>
  );
}

function Stat({
  label,
  hour,
  day,
  hours,
  pick,
  tone,
}: {
  label: string;
  hour: number | null;
  day: number | null;
  hours: readonly ActivityHourDto[];
  pick: (h: ActivityHourDto) => number | null;
  tone?: 'hot';
}) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <dt>{label}</dt>
      <dd className={styles.statHour}>
        {hour ?? '–'}
        <span className={styles.statDay}>{day === null ? '' : ` · ${day} /24h`}</span>
      </dd>
      <dd className={styles.statSpark}>
        <Sparkline
          hours={hours}
          pick={pick}
          label={`${label} per hour, last 24 hours`}
          width={84}
          height={14}
        />
      </dd>
    </div>
  );
}

/**
 * The selected system's last hour in one row: kills (busy from five on), NPC kills and jumps, each
 * with the day as 24 bars. The top of the Kills widget.
 */
export function ActivityStrip({ mapId, solarSystemId }: { mapId: string; solarSystemId: number }) {
  const activity = useSystemActivity(mapId, solarSystemId);
  if (activity.isLoading) return <p className={styles.empty}>Loading activity…</p>;
  if (!activity.data) return <p className={styles.empty}>Activity is not available right now.</p>;
  const { intel, hours } = activity.data;
  return (
    <dl className={styles.stats} aria-label="Last hour">
      <Stat
        label="Kills 1h"
        hour={intel.kills1h}
        day={sum(hours, shipAndPod)}
        hours={hours}
        pick={shipAndPod}
        {...(intel.kills1h >= 5 ? { tone: 'hot' as const } : {})}
      />
      <Stat
        label="NPC 1h"
        hour={intel.npcKills1h}
        day={sum(hours, (h) => h.npcKills)}
        hours={hours}
        pick={(h) => h.npcKills}
      />
      <Stat
        label="Jumps 1h"
        hour={intel.jumps1h}
        day={sum(hours, (h) => h.jumps)}
        hours={hours}
        pick={(h) => h.jumps}
      />
    </dl>
  );
}

/** Who flies in the selected system: alliances, or corporations without one, from its killmails. */
export function WhoFliesHere({ mapId, solarSystemId }: { mapId: string; solarSystemId: number }) {
  const activity = useSystemActivity(mapId, solarSystemId);
  const [span, setSpan] = useState<ActivityWindow>('24h');
  if (!activity.data) return null;
  const shown = activity.data.groups[span];
  return (
    <div className={styles.activity}>
      <div className={styles.groupsHeader}>
        <h3>
          <Users aria-hidden /> Who flies here
        </h3>
        <Segmented
          aria-label="Time window"
          value={span}
          onValueChange={(v) => {
            setSpan(v as ActivityWindow);
            track('activity_viewed', { section: 'activity', window: v as ActivityWindow });
          }}
          options={WINDOWS.map((w) => ({ value: w, label: w }))}
        />
      </div>
      {shown.length === 0 ? (
        <p className={styles.empty}>No killmails here in the {WINDOW_TEXT[span]}.</p>
      ) : (
        <ul className={styles.groups}>
          {shown.map((g) => (
            <Group key={`${g.kind}:${g.entity.id}`} group={g} />
          ))}
        </ul>
      )}
    </div>
  );
}
