import { describe, expect, it } from 'vitest';
import { ValidationError } from '@darkbeacon/core';
import { backupName, isBackupName, utcStamp, type BackupManifest } from './backup.js';
import { backupsToPrune } from './retention.js';
import { describeInterval, isDue, nextRunAt, parseInterval } from './schedule.js';
import { isFailing, EMPTY_BACKUP_STATE, settingsDto, DEFAULT_BACKUP_SETTINGS } from './settings.js';
import { assertRestorable, REQUIRED_TABLES, restoreProblem } from './validation.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

const backup = (daysAgo: number, trigger: BackupManifest['trigger'], n = 0): BackupManifest => ({
  name: backupName(NOW - daysAgo * DAY + n, '0.1.0', 20, new Set()),
  createdAt: NOW - daysAgo * DAY + n,
  size: 1,
  databaseSize: 1,
  sha256: 'x',
  appVersion: '0.1.0',
  schemaVersion: 20,
  trigger,
});

describe('backup names', () => {
  it('say when, which version and which schema, in UTC', () => {
    expect(utcStamp(Date.UTC(2026, 9, 12, 10, 15, 0, 999))).toBe('20261012T101500Z');
    expect(backupName(Date.UTC(2026, 9, 12, 10, 15), '0.1.0', 21)).toBe(
      'darkbeacon-20261012T101500Z-v0.1.0-s21.db.gz',
    );
  });

  it('never collide and never carry a path', () => {
    const first = backupName(NOW, '0.1.0', 1);
    const second = backupName(NOW, '0.1.0', 1, new Set([first]));
    expect(second).toBe(first.replace('.db.gz', '-1.db.gz'));
    expect(isBackupName(second)).toBe(true);
    expect(backupName(NOW, '../../etc', 1)).not.toContain('/');
    for (const bad of ['../app.db', 'darkbeacon-x.db.gz', 'backups.json', `${first}.json`, `a/${first}`]) {
      expect(isBackupName(bad), bad).toBe(false);
    }
  });
});

describe('retention', () => {
  it('keeps the newest automatic backups and every manual one', () => {
    const backups = [
      backup(0, 'scheduled'),
      backup(1, 'scheduled'),
      backup(2, 'pre-restore'),
      backup(3, 'manual'),
      backup(4, 'scheduled'),
      backup(5, 'pre-migration'),
    ];
    const pruned = backupsToPrune(backups, { keep: 3, maxAgeDays: null }, NOW).map((b) => b.createdAt);
    expect(pruned).toEqual([NOW - 4 * DAY, NOW - 5 * DAY]);
  });

  it('removes automatic backups past the age limit but always keeps the newest one', () => {
    const backups = [backup(10, 'scheduled'), backup(20, 'scheduled'), backup(30, 'manual')];
    expect(backupsToPrune(backups, { keep: 14, maxAgeDays: 7 }, NOW).map((b) => b.createdAt)).toEqual([
      NOW - 20 * DAY,
    ]);
    expect(backupsToPrune([backup(10, 'scheduled')], { keep: 1, maxAgeDays: 1 }, NOW)).toEqual([]);
  });
});

describe('schedule', () => {
  it('reads the usual ways to write an interval', () => {
    expect(parseInterval('off')).toBeNull();
    expect(parseInterval('hourly')).toBe(60);
    expect(parseInterval('every 6h')).toBe(360);
    expect(parseInterval('daily')).toBe(1440);
    expect(parseInterval('2d')).toBe(2880);
    expect(parseInterval('30m')).toBe(30);
    expect(() => parseInterval('5m')).toThrow(/15 minutes/);
    expect(() => parseInterval('sometimes')).toThrow(/not a schedule/);
    expect(describeInterval(360)).toBe('every 6 hours');
    expect(describeInterval(null)).toBe('off');
  });

  it('runs at once on a new instance, then every interval, and retries a failure sooner', () => {
    const base = { intervalMinutes: 1440, lastScheduledAt: null, lastScheduledFailed: false };
    expect(nextRunAt(base, NOW)).toBe(NOW);
    expect(nextRunAt({ ...base, lastScheduledAt: NOW }, NOW)).toBe(NOW + DAY);
    expect(nextRunAt({ ...base, lastScheduledAt: NOW, lastScheduledFailed: true }, NOW)).toBe(
      NOW + 3_600_000,
    );
    expect(isDue({ ...base, lastScheduledAt: NOW - DAY }, NOW)).toBe(true);
    expect(isDue({ ...base, lastScheduledAt: NOW - DAY + 1 }, NOW)).toBe(false);
    expect(nextRunAt({ ...base, intervalMinutes: null }, NOW)).toBeNull();
  });
});

describe('restore validation', () => {
  const known = ['core/0001_event_log', 'mapping/0001_mapping'];
  const healthy = { integrity: ['ok'], tables: [...REQUIRED_TABLES, 'webhook'], migrations: known };

  it('accepts a healthy Darkbeacon database of this or an older version', () => {
    expect(restoreProblem(healthy, known)).toBeNull();
    expect(restoreProblem({ ...healthy, migrations: known.slice(0, 1) }, known)).toBeNull();
  });

  it('refuses damaged, foreign and newer databases with a reason', () => {
    expect(
      restoreProblem({ ...healthy, integrity: ['*** in database main ***', 'Page 3 is never used'] }, known),
    ).toMatchObject({ kind: 'damaged' });
    expect(restoreProblem({ ...healthy, tables: ['users'] }, known)).toMatchObject({ kind: 'foreign' });
    expect(restoreProblem({ ...healthy, migrations: [...known, 'mapping/0099_future'] }, known)).toEqual({
      kind: 'newer',
      unknown: ['mapping/0099_future'],
    });
    expect(() => assertRestorable({ ...healthy, tables: [] }, known)).toThrow(ValidationError);
    expect(() => assertRestorable({ ...healthy, migrations: ['x/9999_y'] }, known)).toThrow(
      /newer Darkbeacon/,
    );
  });
});

describe('state', () => {
  it('is failing only while the last failure is newer than the last success', () => {
    const failure = {
      at: 2,
      operation: 'backup' as const,
      trigger: 'scheduled' as const,
      name: null,
      message: 'x',
    };
    const success = { ...failure, message: null, name: 'n' };
    expect(isFailing({ ...EMPTY_BACKUP_STATE, lastFailure: failure })).toBe(true);
    expect(
      isFailing({ ...EMPTY_BACKUP_STATE, lastFailure: failure, lastSuccess: { ...success, at: 3 } }),
    ).toBe(false);
  });

  it('never shows the alert webhook address, only its host', () => {
    expect(
      settingsDto({ ...DEFAULT_BACKUP_SETTINGS, notifyUrl: 'https://discord.com/api/webhooks/1/secret' })
        .notifyHost,
    ).toBe('discord.com');
  });
});
