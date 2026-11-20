"""Read a RemoteTerm database out of a Home Assistant backup.

Layout (probed on a real install, docs/plans/2026-11-19-ha-addon/ha-backup-layout.md):

- outer plain tar: ``./backup.json`` and ``<addon slug>.tar.gz``
- inner gzip tar: ``./addon.json`` (holds tokens: never read here), ``./image.tar``
  (large, skipped) and ``data/`` with ``meshcore.db`` plus its ``-wal``/``-shm``.

A backup of a running add-on keeps most rows in the WAL, so the database file,
its WAL and shared-memory file are taken together, opened with SQLite (which
applies the WAL) and written out as one clean file with ``VACUUM INTO``.

Only those three members are ever written, under names chosen here, so member
paths in the archive cannot place files anywhere else.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import tarfile
import tempfile
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Upstream RemoteTerm's last migration (main, 2026-11-19) is _063. Our _050-_063
# carry the same names; above that the numbers mean different things, so such a
# database cannot be upgraded by our migrations.
UPSTREAM_MAX_SCHEMA = 63

_DB_MEMBERS = {
    "data/meshcore.db": "meshcore.db",
    "data/meshcore.db-wal": "meshcore.db-wal",
    "data/meshcore.db-shm": "meshcore.db-shm",
}
_REMOTETERM_SLUG_SUFFIX = "mc_remoteterm"
_REMOTETERM_URL = "jkingsman/Remote-Terminal-for-MeshCore"
IMPORT_FILENAME = "remoteterm-import.db"


class BackupImportError(Exception):
    """The backup cannot be imported. The message is shown to the user."""


@dataclass
class HaBackupCandidate:
    backup_slug: str
    backup_name: str
    created: str
    addon_slug: str
    addon_name: str
    protected: bool
    filename: str


def _norm(name: str) -> str:
    return name[2:] if name.startswith("./") else name


def is_remoteterm_addon(addon_slug: str, addon_name: str, url: str | None = None) -> bool:
    """True for the RemoteTerm add-on (rajeevan's wrapper or anything built from upstream)."""
    if addon_slug.endswith(_REMOTETERM_SLUG_SUFFIX):
        return True
    return bool(url and _REMOTETERM_URL in url)


def _read_meta(outer: tarfile.TarFile) -> dict:
    for member in outer.getmembers():
        if _norm(member.name) == "backup.json" and member.isfile():
            fh = outer.extractfile(member)
            if fh is None:
                break
            try:
                data = json.loads(fh.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as err:
                raise BackupImportError("The backup's backup.json is not readable") from err
            if isinstance(data, dict):
                return data
            break
    raise BackupImportError("This file is not a Home Assistant backup (no backup.json)")


def list_candidates(backup_dir: str) -> list[HaBackupCandidate]:
    """Backups in ``backup_dir`` that contain a RemoteTerm add-on, newest first."""
    try:
        names = sorted(n for n in os.listdir(backup_dir) if n.endswith(".tar"))
    except OSError:
        return []
    found: list[HaBackupCandidate] = []
    for filename in names:
        try:
            with tarfile.open(os.path.join(backup_dir, filename), mode="r:") as outer:
                meta = _read_meta(outer)
        except (tarfile.TarError, OSError, BackupImportError):
            continue
        for addon in meta.get("addons") or []:
            if not isinstance(addon, dict):
                continue
            slug = str(addon.get("slug") or "")
            name = str(addon.get("name") or "")
            if not is_remoteterm_addon(slug, name):
                continue
            found.append(
                HaBackupCandidate(
                    backup_slug=str(meta.get("slug") or ""),
                    backup_name=str(meta.get("name") or ""),
                    created=str(meta.get("date") or ""),
                    addon_slug=slug,
                    addon_name=name,
                    protected=bool(meta.get("protected")),
                    filename=filename,
                )
            )
    found.sort(key=lambda c: c.created, reverse=True)
    return found


def _copy_db_members(inner_fh, work_dir: str) -> None:
    with tarfile.open(fileobj=inner_fh, mode="r|gz") as inner:
        for member in inner:
            target = _DB_MEMBERS.get(_norm(member.name))
            if target is None or not member.isfile():
                continue
            src = inner.extractfile(member)
            if src is None:
                continue
            with open(os.path.join(work_dir, target), "wb") as out:
                shutil.copyfileobj(src, out)


def extract_database(backup_path: str, addon_slug: str, dest_dir: str) -> str:
    """Write the add-on's database from ``backup_path`` into ``dest_dir``; return its path."""
    try:
        with tarfile.open(backup_path, mode="r:") as outer:
            return _extract_from(outer, addon_slug, dest_dir)
    except (tarfile.ReadError, FileNotFoundError) as err:
        raise BackupImportError("This file is not a readable Home Assistant backup") from err


def _extract_from(outer: tarfile.TarFile, addon_slug: str, dest_dir: str) -> str:
    with tempfile.TemporaryDirectory(dir=dest_dir) as work_dir:
        meta = _read_meta(outer)
        if meta.get("protected"):
            raise BackupImportError(
                "This backup is encrypted. Make a new partial backup of the RemoteTerm "
                "add-on without a password and import that."
            )
        wanted = f"{addon_slug}.tar.gz"
        member = next((m for m in outer.getmembers() if _norm(m.name) == wanted), None)
        if member is None:
            raise BackupImportError(f"The backup does not contain the add-on {addon_slug}")
        inner_fh = outer.extractfile(member)
        if inner_fh is None:
            raise BackupImportError(f"The backup does not contain the add-on {addon_slug}")
        try:
            _copy_db_members(inner_fh, work_dir)
        except (tarfile.TarError, OSError, EOFError) as err:
            raise BackupImportError("The add-on archive in the backup is damaged") from err

        db = os.path.join(work_dir, "meshcore.db")
        if not os.path.exists(db):
            raise BackupImportError("The backup does not contain meshcore.db")

        dest = os.path.join(dest_dir, IMPORT_FILENAME)
        if os.path.exists(dest):
            os.remove(dest)
        try:
            conn = sqlite3.connect(db)
            try:
                conn.execute("VACUUM INTO ?", (dest,))
            finally:
                conn.close()
        except sqlite3.Error as err:
            raise BackupImportError(f"The database in the backup is damaged: {err}") from err
    return dest


def check_upstream_schema(db_path: str) -> int:
    """Refuse a RemoteTerm database newer than our migrations can upgrade."""
    try:
        conn = sqlite3.connect(db_path)
        try:
            version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        finally:
            conn.close()
    except sqlite3.Error as err:
        raise BackupImportError(f"The database in the backup is damaged: {err}") from err
    if version > UPSTREAM_MAX_SCHEMA:
        raise BackupImportError(
            f"This RemoteTerm database is newer than RTFM-EV can import (schema {version}, "
            f"up to {UPSTREAM_MAX_SCHEMA} supported)."
        )
    return version
