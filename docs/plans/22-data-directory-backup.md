# [22] Data-directory backup

Date: 2026-09-12
Status: PLANNING (stub). Requested by Richard, 2026-09-12. Nothing built.
Category: H (Persistence). See `docs/plans/README.md`.
Model: Sonnet.

Scope: local planning only. No code changes, no migrations, no commits, no PRs
from this document.

Product framing: RTFM-EV is a **MeshCore** server + browser terminal driving a
companion radio. All persisted state (contacts, channels, telemetry, raw packet
history, settings) lives in a single SQLite database under the server's data
directory. There is currently no in-app way to snapshot or export that state.

---

## 1. Summary

Provide an operator-facing way to back up the server's data directory so the
accumulated history and configuration survive a host loss, reinstall, or
migration to another machine.

This is the **preserve** complement to plan [19] (analyzer-grade persistence and
retention), which owns the **prune** side of the same data-lifecycle concern (a
per-data-class retention policy plus `POST /api/packets/maintenance`,
`docs/plans/README.md:196`). Backup and retention should share vocabulary and,
ideally, a single "data management" settings surface rather than each inventing
its own.

## 2. What exists today (facts)

- The database is SQLite, accessed through a single-connection `aiosqlite`
  wrapper (`app/database.py:266`), default path `data/meshcore.db`
  (`app/config.py:21`).
- No backup, export, snapshot, or archive route exists in `app/routers/`
  (verified: no match for `backup`/`snapshot`/`archive` on packet or settings
  routers).
- Reporter's host path for the data directory is
  `/home/richard/MeshCore/RTFM-EV/data` (reporter-provided; not a repo constant).

## 3. Open questions (resolve before scoping)

- **What is backed up:** the whole data directory, or just `meshcore.db`?
  UNVERIFIED what else the directory holds beyond the SQLite file at runtime.
- **Consistency:** a live `cp` of an open SQLite file can capture a torn write.
  Assumption: use SQLite's online backup API or `VACUUM INTO` against the live
  connection to produce a consistent snapshot, not a raw file copy. Needs
  confirmation against the single-connection lock model in `app/database.py`.
- **Trigger:** on-demand button in Settings, a CLI/endpoint, a scheduled job, or
  all three?
- **Destination and delivery:** write the archive to a server-side path, offer
  it as a browser download, or both? A browser download of a multi-hundred-MB
  archive has size/streaming implications.
- **Restore:** is restore in scope, or is this backup-only for a first slice?

## 4. Dependencies

- Coordinates with [19] (retention). Backup of a retention-trimmed database is
  smaller and faster; the two should not define competing "data management" UIs.

## 5. References

- `app/database.py`, `app/config.py:21` (SQLite path + connection model).
- `docs/plans/19-analyzer-persistence-retention.md` (retention side of the same
  concern).
