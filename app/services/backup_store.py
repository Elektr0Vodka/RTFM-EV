"""Server-side backup directory: validation, listing, naming and rotation.

Shared by the backup router (manual save, restore-from-server) and the
scheduled-backup loop. Only files named ``meshcore-auto-*.db`` are ever
deleted by rotation; manual and pre-restore snapshots are left alone.
"""

import os
import re
from datetime import UTC, datetime

from app.models import AppSettings

_STAMP_FORMAT = "%Y%m%d-%H%M%S"
AUTO_BACKUP_RE = re.compile(r"^meshcore-auto-(\d{8}-\d{6})\.db$")
MANUAL_BACKUP_RE = re.compile(r"^meshcore-backup-\d{8}-\d{6}\.db$")
PRE_RESTORE_RE = re.compile(r"^meshcore-pre-restore-\d{8}-\d{6}\.db$")


class BackupDirError(Exception):
    """The configured backup directory cannot be used."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _stamp(when: datetime | None = None) -> str:
    return (when or datetime.now(UTC)).strftime(_STAMP_FORMAT)


def manual_backup_filename(when: datetime | None = None) -> str:
    return f"meshcore-backup-{_stamp(when)}.db"


def auto_backup_filename(when: datetime | None = None) -> str:
    return f"meshcore-auto-{_stamp(when)}.db"


def pre_restore_filename(when: datetime | None = None) -> str:
    return f"meshcore-pre-restore-{_stamp(when)}.db"


def resolve_backup_dir(settings: AppSettings) -> str:
    """Return the configured backup directory, or raise ``BackupDirError``."""
    if not settings.backup_to_path_enabled:
        raise BackupDirError(409, "Server-side backup is disabled")
    dest = settings.backup_destination_path.strip()
    if not dest or not os.path.isabs(dest):
        raise BackupDirError(400, "Backup destination must be an absolute path")
    if not os.path.isdir(dest):
        raise BackupDirError(400, "Backup destination is not an existing directory")
    if not os.access(dest, os.W_OK):
        raise BackupDirError(400, "Backup destination is not writable")
    return dest


def _kind(name: str) -> str:
    if AUTO_BACKUP_RE.match(name):
        return "auto"
    if MANUAL_BACKUP_RE.match(name):
        return "manual"
    if PRE_RESTORE_RE.match(name):
        return "pre-restore"
    return "other"


def list_backup_files(directory: str) -> list[dict]:
    """List ``*.db`` files in ``directory`` (not recursive), newest first."""
    files: list[dict] = []
    with os.scandir(directory) as entries:
        for entry in entries:
            if not entry.is_file() or not entry.name.lower().endswith(".db"):
                continue
            stat = entry.stat()
            files.append(
                {
                    "name": entry.name,
                    "size_bytes": stat.st_size,
                    "modified_at": int(stat.st_mtime),
                    "kind": _kind(entry.name),
                }
            )
    files.sort(key=lambda f: (f["modified_at"], f["name"]), reverse=True)
    return files


def resolve_backup_file(directory: str, filename: str) -> str:
    """Resolve a bare filename inside ``directory``; reject anything else."""
    if (
        not filename
        or filename != os.path.basename(filename)
        or "/" in filename
        or "\\" in filename
        or filename in (".", "..")
        or not filename.lower().endswith(".db")
    ):
        raise BackupDirError(400, "Invalid backup file name")
    path = os.path.join(directory, filename)
    real_dir = os.path.realpath(directory)
    if os.path.dirname(os.path.realpath(path)) != real_dir or not os.path.isfile(path):
        raise BackupDirError(404, "Backup file not found")
    return path


def auto_backup_times(directory: str) -> list[tuple[datetime, str]]:
    """Automatic snapshots in ``directory`` as (UTC time from name, filename), oldest first."""
    found: list[tuple[datetime, str]] = []
    for name in os.listdir(directory):
        match = AUTO_BACKUP_RE.match(name)
        if not match:
            continue
        try:
            when = datetime.strptime(match.group(1), _STAMP_FORMAT).replace(tzinfo=UTC)
        except ValueError:
            continue
        found.append((when, name))
    found.sort()
    return found


def rotate_auto_backups(directory: str, keep: int) -> list[str]:
    """Delete all but the newest ``keep`` automatic snapshots. Returns deleted names."""
    autos = auto_backup_times(directory)
    excess = autos[: max(0, len(autos) - max(1, keep))]
    deleted: list[str] = []
    for _, name in excess:
        try:
            os.remove(os.path.join(directory, name))
            deleted.append(name)
        except OSError:
            continue
    return deleted
