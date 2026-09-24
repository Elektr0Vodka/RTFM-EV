"""Database restore: validate and stage a backup now, swap it in at next startup.

Restoring into a running server would leave a lot of in-memory state (radio
sync, caches, fanout) built from the old database, so a restore is two-phase:

1. ``stage_restore`` validates a backup file and copies it next to the live
   database as ``<db>.restore-pending`` (plus a small JSON sidecar describing
   it). The live database is not touched.
2. ``apply_pending_restore`` runs at startup, before the database connection
   opens. It snapshots the current database with ``VACUUM INTO`` to
   ``meshcore-pre-restore-<stamp>.db`` in the same directory, removes the old
   ``-wal``/``-shm`` files (so they are never replayed onto the restored file),
   and moves the staged file into place. The normal startup migrations then
   upgrade an older backup to the current schema.

The outcome is written to ``<db>.restore-result.json`` so the UI can report it.
A staged file that fails at apply time is moved aside to ``<db>.restore-failed``
and the live database is left as it was.
"""

import json
import logging
import os
import shutil
import sqlite3
import time
from datetime import UTC, datetime

from app.migrations import latest_version
from app.services.backup_store import pre_restore_filename

logger = logging.getLogger(__name__)

PENDING_SUFFIX = ".restore-pending"
PENDING_META_SUFFIX = ".restore-pending.json"
STAGING_SUFFIX = ".restore-staging"
FAILED_SUFFIX = ".restore-failed"
RESULT_SUFFIX = ".restore-result.json"

SQLITE_MAGIC = b"SQLite format 3\x00"
REQUIRED_TABLES = frozenset({"app_settings", "contacts", "channels", "messages"})


class RestoreValidationError(ValueError):
    """The file cannot be restored (not SQLite, not RemoteTerm, too new, damaged)."""


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _remove_sidecars(path: str) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        _remove(path + suffix)


def validate_backup_file(path: str) -> int:
    """Check that ``path`` is an intact RemoteTerm database this build can open.

    Returns its schema version (SQLite ``user_version``).
    """
    try:
        with open(path, "rb") as fh:
            header = fh.read(len(SQLITE_MAGIC))
    except OSError as err:
        raise RestoreValidationError(f"Cannot read backup file: {err}") from err
    if header != SQLITE_MAGIC:
        raise RestoreValidationError("File is not a SQLite database")

    try:
        conn = sqlite3.connect(path)
    except sqlite3.Error as err:
        raise RestoreValidationError(f"Cannot open backup file: {err}") from err
    try:
        check = conn.execute("PRAGMA quick_check").fetchone()
        if not check or check[0] != "ok":
            raise RestoreValidationError("Backup file failed the SQLite integrity check")
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        missing = REQUIRED_TABLES - tables
        if missing:
            raise RestoreValidationError(
                "File is not a RemoteTerm database (missing tables: "
                + ", ".join(sorted(missing))
                + ")"
            )
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    except sqlite3.DatabaseError as err:
        raise RestoreValidationError(f"Backup file is damaged: {err}") from err
    finally:
        conn.close()
        _remove_sidecars(path)

    latest = latest_version()
    if version > latest:
        raise RestoreValidationError(
            f"Backup was made by a newer version (schema {version}; this build supports "
            f"up to {latest}). Update RemoteTerm before restoring it."
        )
    return version


def _read_json(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)


def stage_restore(
    src_path: str,
    db_path: str,
    *,
    source: str,
    original_name: str,
    move: bool = False,
) -> dict:
    """Validate ``src_path`` and stage it to replace ``db_path`` at next startup.

    Replaces any previously staged restore. Raises ``RestoreValidationError``
    (nothing is staged) when the file is not restorable.
    """
    staging = db_path + STAGING_SUFFIX
    pending = db_path + PENDING_SUFFIX
    _remove(staging)
    try:
        if move:
            shutil.move(src_path, staging)
        else:
            shutil.copyfile(src_path, staging)
        schema_version = validate_backup_file(staging)
        os.replace(staging, pending)
    except BaseException:
        _remove(staging)
        _remove_sidecars(staging)
        raise

    meta = {
        "source": source,
        "original_name": original_name,
        "size_bytes": os.path.getsize(pending),
        "schema_version": schema_version,
        "staged_at": int(time.time()),
    }
    _write_json(db_path + PENDING_META_SUFFIX, meta)
    logger.info(
        "Staged database restore from %s (%s, schema %d); applies on next restart",
        source,
        original_name,
        schema_version,
    )
    return meta


def get_pending(db_path: str) -> dict | None:
    pending = db_path + PENDING_SUFFIX
    if not os.path.isfile(pending):
        return None
    meta = _read_json(db_path + PENDING_META_SUFFIX) or {}
    return {
        "source": meta.get("source", "unknown"),
        "original_name": meta.get("original_name", os.path.basename(pending)),
        "size_bytes": os.path.getsize(pending),
        "schema_version": meta.get("schema_version"),
        "staged_at": meta.get("staged_at", int(os.path.getmtime(pending))),
    }


def cancel_pending(db_path: str) -> bool:
    existed = os.path.isfile(db_path + PENDING_SUFFIX)
    _remove(db_path + PENDING_SUFFIX)
    _remove(db_path + PENDING_META_SUFFIX)
    if existed:
        logger.info("Cancelled staged database restore")
    return existed


def get_last_result(db_path: str) -> dict | None:
    return _read_json(db_path + RESULT_SUFFIX)


def dismiss_last_result(db_path: str) -> bool:
    existed = os.path.isfile(db_path + RESULT_SUFFIX)
    _remove(db_path + RESULT_SUFFIX)
    return existed


def apply_pending_restore(db_path: str) -> dict | None:
    """Swap a staged backup into place. Call before the database connection opens.

    Returns the result record, or ``None`` when nothing was staged.
    """
    pending = db_path + PENDING_SUFFIX
    if not os.path.isfile(pending):
        return None

    meta = _read_json(db_path + PENDING_META_SUFFIX) or {}
    now = datetime.now(UTC)
    result: dict = {
        "ok": False,
        "applied_at": int(now.timestamp()),
        "source": meta.get("source", "unknown"),
        "original_name": meta.get("original_name", ""),
        "pre_restore_snapshot": None,
        "error": None,
    }
    try:
        result["schema_version"] = validate_backup_file(pending)
        if os.path.isfile(db_path):
            snapshot = os.path.join(
                os.path.dirname(os.path.abspath(db_path)), pre_restore_filename(now)
            )
            conn = sqlite3.connect(db_path)
            try:
                conn.execute("VACUUM INTO ?", (snapshot,))
            finally:
                conn.close()
            result["pre_restore_snapshot"] = snapshot
        # Old WAL/SHM belong to the previous database; replaying them onto the
        # restored file would corrupt it.
        _remove_sidecars(db_path)
        os.replace(pending, db_path)
        result["ok"] = True
        logger.warning(
            "Restored database from %s (%s); previous database saved to %s",
            result["source"],
            result["original_name"],
            result["pre_restore_snapshot"] or "(none, no previous database)",
        )
    except Exception as err:
        result["error"] = str(err)
        logger.exception("Database restore failed; keeping the current database")
        try:
            os.replace(pending, db_path + FAILED_SUFFIX)
        except OSError:
            _remove(pending)
    finally:
        _remove(db_path + PENDING_META_SUFFIX)

    try:
        _write_json(db_path + RESULT_SUFFIX, result)
    except OSError:
        logger.warning("Could not record the database restore result", exc_info=True)
    return result
