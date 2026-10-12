# Backups

Darkbeacon backs its SQLite database up by itself, while it runs, and restores a backup from inside the
app. This page is for the person running the container. On PostgreSQL, see [PostgreSQL](#postgresql) at
the end: built-in backups are for SQLite only.

## What is backed up, and where

```
/data                     the volume (DATA_DIR)
├── app.db                the database (plus app.db-wal and app.db-shm while it runs)
├── secret.key            the generated SECRET_KEY, if you did not set one
├── plugins/              installed plugin packages
└── backups/              BACKUP_DIR
    ├── darkbeacon-20261012T101500Z-v0.1.0-s21.db.gz        a backup
    ├── darkbeacon-20261012T101500Z-v0.1.0-s21.db.gz.json   its manifest
    ├── backups.json      schedule, retention and the last results (owner-readable only)
    └── .tmp/             work files while a backup or an upload is in progress
```

A backup is the whole database, compressed with gzip. Its name says when it was made (UTC), by which
version of Darkbeacon, and at which schema version (the number of migrations applied). The manifest next to
it holds the size, the SHA-256 of the file, both versions and why it was made: `manual` (Back up now),
`scheduled`, `pre-restore` (the database as it was right before a restore) or `pre-migration` (the database
as it was before an update changed it).

Backups are made while everything keeps running: the copy is taken between two transactions, so it is
always consistent, and requests only wait for the few milliseconds the copy of each step takes.

**Not in a backup:** `secret.key` (or your `SECRET_KEY`) and `plugins/`. EVE tokens, webhook secrets and the
Discord bot token in the database are encrypted with a key derived from the secret: restoring onto another
server needs the same secret, or those have to be entered again (characters re-linked, the bot connected
again). Copy `secret.key` somewhere safe once; it never changes. Plugins shipped with Darkbeacon come back
by themselves; others are installed again from Admin > Plugins.

## Schedule and retention

Admin > Backups sets how often backups run (off, every hour, 6 or 12 hours, daily, weekly), how many
automatic backups to keep and, optionally, after how many days they are removed. Manual backups are never
removed automatically, and the newest automatic backup always stays. The environment sets the defaults:

| Variable               | Default              | Meaning                                                                        |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `BACKUP_DIR`           | `<DATA_DIR>/backups` | Where backups go. Another mounted volume works too.                            |
| `BACKUP_SCHEDULE`      | `daily`              | `off`, `hourly`, `daily`, `weekly`, or `30m`, `6h`, `2d` (at least 15 minutes) |
| `BACKUP_RETENTION`     | `14`                 | Automatic backups kept                                                         |
| `BACKUP_MAX_AGE_DAYS`  | none                 | Remove automatic backups older than this                                       |
| `BACKUP_MAX_UPLOAD_MB` | `1024`               | Largest file an upload restore accepts (the database inside may be 10x)        |
| `BACKUP_NOTIFY_URL`    | none                 | Alert webhook (see below)                                                      |

What an admin changes in the app wins over the environment and is kept in `backups/backups.json`, next to
the backups rather than in the database, so restoring a backup never changes the schedule.

The first scheduled backup runs about a minute after a new instance starts; after that, one interval after
the last one (an hour after a failure). Only one backup or restore runs at a time, also across the CLI.
Before an update runs database migrations on an existing database, Darkbeacon backs it up first
(`pre-migration`); if that fails the update still starts, and the failure shows in Admin > Backups.

## When a backup fails

A failed backup shows at the top of the Admin page and in the Backups section until a later one works, and
is recorded in the audit trail (Admin > Audit). With an alert webhook, failures and restores are also posted
there: a Discord channel webhook gets a message, any other address a JSON `POST`
(`{ "event": "backup.failed", "title", "body", "instance" }`). Successful backups are posted only when you
switch that on. The address is stored on the server and only its host is ever shown. Plugins that provide a
notifier receive the same alerts as instance notifications.

## Copying backups off the server

A backup on the same disk as the database does not survive that disk. Copy them somewhere else now and
then:

- **From the browser:** Admin > Backups, the download button of a backup.
- **From the host,** with the volume as Docker manages it:

  ```sh
  docker cp darkbeacon:/data/backups ./darkbeacon-backups        # everything, while it runs
  ```

- **On a schedule,** e.g. a nightly cron job on the host that syncs the directory elsewhere:

  ```sh
  docker run --rm -v dbk-data:/data:ro -v /mnt/offsite:/out alpine \
    sh -c 'cp -n /data/backups/*.db.gz* /out/'
  ```

  Or mount `BACKUP_DIR` from a directory your existing backup tool already covers
  (`-v /srv/backups/darkbeacon:/data/backups`).

To bring one back, copy the `.db.gz` file into `BACKUP_DIR` (its `.json` is optional: without it the file is
listed as a manual backup) or upload it in Admin > Backups.

Copying is all there is to off-site backups today. The storage behind backups is one port
(`BackupStorage`), so an S3-compatible bucket can be added as another adapter later.

## Restore from the app

Admin > Backups, **Restore…** on a backup, or **Restore from a file** for a `.db.gz` (or a plain SQLite file)
from this or another Darkbeacon. Type `RESTORE` to confirm. Then:

1. The file is checked before anything changes: it must decompress, pass SQLite's integrity check, be a
   Darkbeacon database, and come from this version or an older one. A backup from a newer Darkbeacon is
   refused: update this server first.
2. Darkbeacon goes into maintenance: changes are refused, pages show "Back in a moment", and the work in
   flight finishes.
3. The current database is backed up (`pre-restore`).
4. The file is swapped in atomically and migrations bring an older backup up to this version.
5. If any step fails, the previous database is put back and nothing changed.
6. Maintenance ends. Everyone's page reloads by itself; people who signed in after the backup was made sign
   in again (their sessions are not in it).

The history in the audit trail continues from the backup; the restore itself is recorded in it. The
database as it was is in the `pre-restore` backup, which can be restored the same way.

## The command line

For when the web app is not an option, the image has a `darkbeacon` command:

```sh
docker exec -it darkbeacon darkbeacon backup list
docker exec -it darkbeacon darkbeacon backup create       # works while the server runs
docker exec -it darkbeacon darkbeacon backup verify <name or file>
```

A restore from the command line needs the server stopped (it refuses while it answers), so run it in a
one-off container on the same volume:

```sh
docker stop darkbeacon
docker run --rm -it -v dbk-data:/data darkbeacon darkbeacon backup restore darkbeacon-20261012T101500Z-v0.1.0-s21.db.gz
docker start darkbeacon
```

`restore` takes a name from `backup list` or a path to any `.db.gz` or SQLite file inside the container (mount
the directory it is in). It asks you to type `RESTORE` (pass `--yes` in scripts), takes the same checks and
the same `pre-restore` backup as the app, and works on an empty volume too (a new server restored from a
backup). `--force` takes over a lock left by a backup that was killed.

## PostgreSQL

With `DATABASE_URL` set, Darkbeacon keeps nothing in `app.db` and the Backups section says so. Back the
database up with PostgreSQL's own tools, e.g. a nightly:

```sh
pg_dump --format=custom --file=darkbeacon-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
```

and restore into an empty database with `pg_restore --clean --if-exists -d "$DATABASE_URL" <file>` while
Darkbeacon is stopped. Managed PostgreSQL services usually offer point-in-time recovery as well. See the
[PostgreSQL backup guide](https://www.postgresql.org/docs/current/backup-dump.html).
