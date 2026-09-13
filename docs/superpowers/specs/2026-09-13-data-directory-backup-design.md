# Design: in-app database backup

Date: 2026-09-13
Issue: Elektr0Vodka/RTFM-EV#85 ("Back up the server data directory from within the app")
Related plans: `docs/plans/22-data-directory-backup.md` (this issue's stub), `docs/plans/19-analyzer-persistence-retention.md` (the prune/retention complement).
Status: design approved 2026-09-13. Backup-only first slice.

## 1. Problem

All persisted RTFM-EV state (contacts, channels, telemetry, raw packet history,
settings) lives in a single SQLite database at the configured `database_path`
(default `data/meshcore.db`, `app/config.py:21`). There is no in-app way to
snapshot or export it, so accumulated history and configuration do not survive a
host loss, reinstall, or migration to another machine.

## 2. Decisions (from issue #85 open questions)

Resolved with the maintainer on 2026-09-13:

- **What is backed up:** `meshcore.db` only, produced as a consistent single-file
  snapshot. Non-DB configuration is env/file driven (`app/config.py`), not part
  of the data directory's runtime state.
- **Consistency:** use SQLite `VACUUM INTO`, not a raw file copy. Justification in
  §3.
- **Trigger:** on-demand only for this slice — a Settings button plus a direct
  browser download. No scheduled/automatic job.
- **Delivery:** two paths — (a) browser download; (b) server-side write to an
  operator-configured filesystem destination directory, behind a settings toggle.
  A local-network target is supported when it is an OS-mounted share; the app
  writes a filesystem path and does not itself speak SMB/NFS/SFTP.
- **Restore:** out of scope for this slice. Documented manual procedure only.

## 3. Backup mechanism and consistency

The database runs in WAL mode on a single `aiosqlite` connection serialized by an
internal `asyncio` lock (`app/database.py:266`, `connect()` sets
`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`).

The snapshot is produced with:

```sql
VACUUM INTO '<target-path>'
```

executed on the live connection while holding the connection lock and with no
open transaction. `VACUUM INTO` reads a single consistent transactional view of
the database and writes a fresh, defragmented database file to `<target-path>`.
This avoids the torn-write hazard of copying an open WAL-mode file with `cp`, and
needs no second connection.

Implementation notes:
- `VACUUM` cannot run inside an explicit transaction. The backup service must run
  it in autocommit state (no active `db.tx()` block). It acquires the lock via a
  dedicated `DatabaseManager` helper rather than reusing the `tx()` write path.
- `VACUUM INTO` requires a file target that does not already exist; the service
  writes to a fresh path (temp file for download, timestamped filename for
  server-side save).
- Free disk space of roughly the current DB size is required transiently for the
  temp copy (download path).

## 4. API — new router `app/routers/backup.py` (prefix `/backup`, tag `backup`)

Mounted under the existing `/api` prefix like other routers.

### `GET /api/backup/download`
1. `VACUUM INTO` a uniquely named temp file (system temp dir).
2. Return `FileResponse(tmpfile, media_type="application/x-sqlite3", filename="meshcore-backup-YYYYMMDD-HHMMSS.db")` with `Content-Disposition: attachment`.
3. Delete the temp file after the response is sent via a `BackgroundTask`.

Streaming from disk keeps memory flat for large databases.

### `POST /api/backup/save`
- Preconditions: `backup_to_path_enabled` is true and `backup_destination_path`
  is a valid destination (see §5). Otherwise return HTTP 400 (misconfigured) or
  409 (disabled) with a clear message.
- `VACUUM INTO` directly to `<destination>/meshcore-backup-YYYYMMDD-HHMMSS.db`.
- Response body: `{ "path": <str>, "size_bytes": <int>, "timestamp": <iso8601> }`.

Filenames use a UTC timestamp so repeated saves do not overwrite each other.

## 5. Settings (migration `_082`)

Latest migration on `origin/main` is `_081_create_wordlists.py` as of 2026-09-13;
re-verify the next free number at build time
(`git ls-tree -r --name-only origin/main app/migrations`) because parallel
branches race for it.

Add two columns to the single-row `app_settings` table (mirroring
`_076_add_external_map_settings.py`):

- `backup_to_path_enabled` INTEGER/bool, default `0` (false).
- `backup_destination_path` TEXT, default `''`.

Surface them through:
- `AppSettings` model (`app/models.py`) with defaults.
- `AppSettingsUpdate` (`app/routers/settings.py`) for partial updates.
- `AppSettingsRepository` load/update paths (`app/repository/settings.py`).

Destination validation, applied when `POST /api/backup/save` runs (and, softly,
when the value is set): the path must be an absolute, existing, writable
directory. Reject empty/relative paths and non-directories with a specific error.
The operator is trusted (this is an admin-facing server), so no sandboxing of the
path beyond "must be a writable directory" is imposed; a local-network share is
valid when mounted.

## 6. Frontend — "Data management" section in Settings

A new section grouped so plan [19]'s retention/maintenance controls can later
join it (shared surface, per issue #85 and plan [22] §1).

- **Download backup** button — always enabled; triggers `GET /api/backup/download`
  (browser download).
- **Server-side backup** subgroup:
  - Enable toggle bound to `backup_to_path_enabled`.
  - Destination-path text input bound to `backup_destination_path` (persisted via
    the existing settings update flow).
  - **Back up to server now** button — enabled only when the toggle is on and a
    path is set; triggers `POST /api/backup/save` and shows the returned path and
    size, or the validation error.

All new user-facing strings get `t()` keys with EN/NL/DE translations (i18n is
lint- and parity-test-enforced in this repo).

## 7. Out of scope (follow-ups)

- **Restore.** Documented manual procedure only: stop the server, replace
  `data/meshcore.db` with the backup file, delete `data/meshcore.db-wal` and
  `data/meshcore.db-shm` if present, restart. An in-app restore (safe swap of the
  live single connection, validation, rollback) is a separate, riskier feature.
- **Scheduled/automatic backups** (scheduler, rotation, disk management).
- **Network-storage protocol clients** (SMB/NFS/SFTP spoken by the app).

## 8. Testing

- **Service test:** seed a temp SQLite DB with representative rows, run the backup
  service to a target path, then open the result and assert `PRAGMA
  integrity_check` returns `ok` and per-table row counts match the source.
- **Endpoint tests:**
  - `GET /api/backup/download` returns 200, an `attachment` `Content-Disposition`,
    and bytes that open as a valid SQLite database.
  - `POST /api/backup/save` writes a file to a temp destination and returns
    correct `path`/`size_bytes`/`timestamp`.
  - `POST /api/backup/save` is rejected when the toggle is off, when the path is
    empty/relative, and when the path is not a writable directory.
- **Settings persistence test** for `backup_to_path_enabled` and
  `backup_destination_path` (round-trip through the repository).
- **i18n parity test** covers the new keys across EN/NL/DE (existing enforced
  test).

Backend tests run in the `rtfm-ev-local` container against `/app/.venv` with the
worktree bind-mounted to `/work` (repo convention).

## 9. Documentation

- `CHANGELOG-DMC-EV.md`: entry under the appropriate area, referencing issue #85
  and the PR/commit.
- `README.md` / `README_ADVANCED.md`: document the backup feature and the manual
  restore procedure from §7.
- `docs/plans/22-data-directory-backup.md`: update status from PLANNING stub to
  reflect the delivered first slice and the deferred follow-ups.
- `docs/plans/README.md`: update the delivery table row for [22].
- Do not edit `CHANGELOG.md` (upstream, release-script managed).

## 10. References

- `app/database.py:266` — single-connection WAL model and PRAGMAs.
- `app/config.py:21` — `database_path` default.
- `app/routers/packets.py:996` — `POST /api/packets/maintenance` (the retention
  sibling this should sit beside).
- `app/routers/settings.py`, `app/repository/settings.py`,
  `app/migrations/_076_add_external_map_settings.py` — settings column pattern.
