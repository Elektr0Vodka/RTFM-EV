import logging
import os
import shutil
import tempfile
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.database import db
from app.repository import AppSettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backup", tags=["backup"])


def _timestamped_filename() -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"meshcore-backup-{stamp}.db"


class BackupSaveResult(BaseModel):
    path: str
    size_bytes: int
    timestamp: str


@router.get("/download")
async def download_backup() -> FileResponse:
    """Stream a consistent snapshot of the database to the caller as a download."""
    tmp_dir = tempfile.mkdtemp(prefix="meshcore-backup-")
    filename = _timestamped_filename()
    target = os.path.join(tmp_dir, filename)
    try:
        await db.backup_to(target)
    except Exception as err:
        # Best-effort cleanup on failure so we don't leak temp dirs.
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.exception("Backup snapshot failed")
        raise HTTPException(status_code=500, detail="Failed to create database backup") from err

    def _cleanup() -> None:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return FileResponse(
        path=target,
        media_type="application/octet-stream",
        filename=filename,
        background=BackgroundTask(_cleanup),
    )


@router.post("/save", response_model=BackupSaveResult)
async def save_backup() -> BackupSaveResult:
    """Write a consistent snapshot to the configured server-side directory."""
    settings = await AppSettingsRepository.get()
    if not settings.backup_to_path_enabled:
        raise HTTPException(status_code=409, detail="Server-side backup is disabled")

    dest = settings.backup_destination_path.strip()
    if not dest or not os.path.isabs(dest):
        raise HTTPException(status_code=400, detail="Backup destination must be an absolute path")
    if not os.path.isdir(dest):
        raise HTTPException(
            status_code=400, detail="Backup destination is not an existing directory"
        )
    if not os.access(dest, os.W_OK):
        raise HTTPException(status_code=400, detail="Backup destination is not writable")

    filename = _timestamped_filename()
    target = os.path.join(dest, filename)
    try:
        await db.backup_to(target)
    except Exception as err:
        logger.exception("Server-side backup failed")
        raise HTTPException(status_code=500, detail="Failed to write database backup") from err

    return BackupSaveResult(
        path=target,
        size_bytes=os.path.getsize(target),
        timestamp=datetime.now(UTC).isoformat(),
    )
