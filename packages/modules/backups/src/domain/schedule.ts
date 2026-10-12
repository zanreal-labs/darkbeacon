const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** After a failed scheduled backup, the next try comes after at most this long. */
export const RETRY_AFTER_FAILURE_MS = 60 * MINUTE;

const NAMED: Record<string, number | null> = {
  off: null,
  none: null,
  never: null,
  hourly: 60,
  daily: DAY_MINUTES,
  weekly: 7 * DAY_MINUTES,
};

/**
 * `BACKUP_SCHEDULE` in minutes: `off`, `hourly`, `daily`, `weekly`, or a number with a unit
 * (`30m`, `6h`, `2d`; `every 6h` reads too). Null: no schedule. Throws on anything else.
 */
export function parseInterval(text: string): number | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/^every\s+/, '');
  if (value in NAMED) return NAMED[value]!;
  const match = /^(\d+)\s*(m|min|h|d)$/.exec(value);
  if (!match) throw new Error(`"${text}" is not a schedule (try off, hourly, 6h, daily or weekly)`);
  const n = Number(match[1]);
  const minutes = match[2] === 'd' ? n * DAY_MINUTES : match[2] === 'h' ? n * 60 : n;
  if (minutes < 15) throw new Error('backups can run at most every 15 minutes');
  return minutes;
}

/** "every 6 hours", "daily"... */
export function describeInterval(minutes: number | null): string {
  if (minutes === null) return 'off';
  if (minutes === DAY_MINUTES) return 'daily';
  if (minutes === 7 * DAY_MINUTES) return 'weekly';
  if (minutes === 60) return 'hourly';
  if (minutes % DAY_MINUTES === 0) return `every ${minutes / DAY_MINUTES} days`;
  if (minutes % 60 === 0) return `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}

export interface ScheduleState {
  intervalMinutes: number | null;
  /** When the last scheduled backup started, whatever came of it. */
  lastScheduledAt: number | null;
  /** Whether that one failed (a failed run is retried sooner). */
  lastScheduledFailed: boolean;
}

/**
 * When the next scheduled backup is due: an interval after the last scheduled one (at most an
 * hour after a failure); now when none ran yet, so a new instance has a backup soon. Null: off.
 */
export function nextRunAt(state: ScheduleState, now: number): number | null {
  if (state.intervalMinutes === null) return null;
  if (state.lastScheduledAt === null) return now;
  const interval = state.intervalMinutes * MINUTE;
  return (
    state.lastScheduledAt +
    (state.lastScheduledFailed ? Math.min(interval, RETRY_AFTER_FAILURE_MS) : interval)
  );
}

export function isDue(state: ScheduleState, now: number): boolean {
  const next = nextRunAt(state, now);
  return next !== null && next <= now;
}
