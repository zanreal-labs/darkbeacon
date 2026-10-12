export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** ESI's hourly figures of one system; a figure ESI has not given for that hour is null. */
export interface ActivityHour {
  systemId: number;
  /** Start of the hour (epoch ms). */
  hour: number;
  shipKills: number | null;
  podKills: number | null;
  npcKills: number | null;
  jumps: number | null;
}

export type ActivityKind = 'kills' | 'jumps';

export function hourOf(time: number): number {
  return Math.floor(time / HOUR) * HOUR;
}

/**
 * The hour an ESI answer describes. ESI says its figures are "within the last hour ending at the
 * timestamp of the Last-Modified header", so they belong to the hour before it.
 */
export function esiHour(lastModified: number): number {
  return hourOf(lastModified - HOUR);
}

/** The last `count` hours up to now's, oldest first. */
export function lastHours(now: number, count = 24): number[] {
  const current = hourOf(now);
  return Array.from({ length: count }, (_, i) => current - (count - 1 - i) * HOUR);
}

/**
 * A system's hourly series: stored rows where there are some; in an hour ESI answered for but did
 * not list the system, zero (ESI lists only systems with something to count); null elsewhere.
 */
export function activitySeries(
  systemId: number,
  rows: readonly ActivityHour[],
  fetched: { kills: ReadonlySet<number>; jumps: ReadonlySet<number> },
  hours: readonly number[],
): ActivityHour[] {
  const byHour = new Map(rows.filter((r) => r.systemId === systemId).map((r) => [r.hour, r]));
  return hours.map((hour) => {
    const row = byHour.get(hour);
    const kills = fetched.kills.has(hour);
    const jumps = fetched.jumps.has(hour);
    return {
      systemId,
      hour,
      shipKills: row?.shipKills ?? (kills ? 0 : null),
      podKills: row?.podKills ?? (kills ? 0 : null),
      npcKills: row?.npcKills ?? (kills ? 0 : null),
      jumps: row?.jumps ?? (jumps ? 0 : null),
    };
  });
}

/** The newest hour of a series that has any figure, if it is no older than two hours. */
export function latestHour(series: readonly ActivityHour[], now: number): ActivityHour | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const h = series[i]!;
    if (h.hour < hourOf(now) - 2 * HOUR) return null;
    if (h.shipKills !== null || h.jumps !== null) return h;
  }
  return null;
}

/**
 * Ships and pods destroyed in the last hour. zKillboard's killmails of the last 60 minutes are the
 * freshest count, and the only one in wormhole space (ESI leaves it out); when they are complete
 * (followed live and fetched for at least the last hour) they are the answer, otherwise the larger
 * of them and ESI's last hourly figure.
 */
export function killsLastHour(input: {
  zkill: number;
  esi: Pick<ActivityHour, 'shipKills' | 'podKills'> | null;
  complete: boolean;
}): number {
  if (input.complete) return input.zkill;
  const esi = (input.esi?.shipKills ?? 0) + (input.esi?.podKills ?? 0);
  return Math.max(esi, input.zkill);
}
