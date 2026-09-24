import logging
import os
import shutil
import tempfile
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.database import db
from app.repository import AppSettingsRepository
from app.services import db_restore
from app.services.backup_store import (
    BackupDirError,
    list_backup_files,
    manual_backup_filename,
    resolve_backup_dir,
    resolve_backup_file,
)
from app.services.db_restore import RestoreValidationError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backup", tags=["backup"])

UPLOAD_CHUNK_BYTES = 1024 * 1024


def _db_path() -> str:
    return db.db_path


class BackupSaveResult(BaseModel):
    path: str
    size_bytes: int
    timestamp: str


class BackupFile(BaseModel):
    name: str
    size_bytes: int
    modified_at: int
    kind: str


class BackupFilesResponse(BaseModel):
    enabled: bool
    path: str
    files: list[BackupFile]
    error: str | None = None


class PendingRestore(BaseModel):
    source: str
    original_name: str
    size_bytes: int
    schema_version: int | None = None
    staged_at: int


class RestoreResult(BaseModel):
    ok: bool
    applied_at: int
    source: str
    original_name: str
    pre_restore_snapshot: str | None = None
    schema_version: int | None = None
    error: str | None = None


class RestoreStatus(BaseModel):
    pending: PendingRestore | None = None
    last_result: RestoreResult | None = None


class RestoreFromServerRequest(BaseModel):
    filename: str


def _restore_status() -> RestoreStatus:
    path = _db_path()
    pending = db_restore.get_pending(path)
    last = db_restore.get_last_result(path)
    return RestoreStatus(
        pending=PendingRestore(**pending) if pending else None,
        last_result=RestoreResult(**last) if last else None,
    )


@router.get("/download")
async def download_backup() -> FileResponse:
    """Stream a consistent snapshot of the database to the caller as a download."""
    tmp_dir = tempfile.mkdtemp(prefix="meshcore-backup-")
    filename = manual_backup_filename()
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
    try:
        dest = resolve_backup_dir(settings)
    except BackupDirError as err:
        raise HTTPException(status_code=err.status_code, detail=err.detail) from err

    target = os.path.join(dest, manual_backup_filename())
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


@router.get("/files", response_model=BackupFilesResponse)
async def list_backup_files_endpoint() -> BackupFilesResponse:
    """List the .db files in the server-side backup directory, newest first."""
    settings = await AppSettingsRepository.get()
    path = settings.backup_destination_path.strip()
    if not settings.backup_to_path_enabled:
        return BackupFilesResponse(enabled=False, path=path, files=[])
    try:
        dest = resolve_backup_dir(settings)
        files = [BackupFile(**f) for f in list_backup_files(dest)]
    except BackupDirError as err:
        return BackupFilesResponse(enabled=True, path=path, files=[], error=err.detail)
    except OSError as err:
        return BackupFilesResponse(enabled=True, path=path, files=[], error=str(err))
    return BackupFilesResponse(enabled=True, path=path, files=files)


@router.get("/restore", response_model=RestoreStatus)
async def get_restore_status() -> RestoreStatus:
    """Report a staged restore (applies on next restart) and the last restore outcome."""
    return _restore_status()


@router.post("/restore/upload", response_model=RestoreStatus)
async def restore_from_upload(file: Annotated[UploadFile, File()]) -> RestoreStatus:
    """Stage an uploaded backup to replace the database on the next restart.

    The file is validated (SQLite, RemoteTerm tables, integrity, not a newer
    schema) before it is staged. The live database is not changed until the
    server restarts, and the current database is snapshotted first then.
    """
    path = _db_path()
    data_dir = os.path.dirname(os.path.abspath(path))
    os.makedirs(data_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="restore-upload-", suffix=".tmp", dir=data_dir)
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(UPLOAD_CHUNK_BYTES):
                out.write(chunk)
        db_restore.stage_restore(
            tmp,
            path,
            source="upload",
            original_name=os.path.basename(file.filename or "upload.db"),
            move=True,
        )
    except RestoreValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except OSError as err:
        logger.exception("Staging uploaded restore failed")
        raise HTTPException(status_code=500, detail="Failed to stage the uploaded backup") from err
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return _restore_status()


@router.post("/restore/server", response_model=RestoreStatus)
async def restore_from_server(request: RestoreFromServerRequest) -> RestoreStatus:
    """Stage a backup from the server-side backup directory for the next restart."""
    settings = await AppSettingsRepository.get()
    try:
        dest = resolve_backup_dir(settings)
        src = resolve_backup_file(dest, request.filename)
    except BackupDirError as err:
        raise HTTPException(status_code=err.status_code, detail=err.detail) from err
    try:
        db_restore.stage_restore(src, _db_path(), source="server", original_name=request.filename)
    except RestoreValidationError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except OSError as err:
        logger.exception("Staging server-side restore failed")
        raise HTTPException(status_code=500, detail="Failed to stage the backup") from err
    return _restore_status()


@router.delete("/restore", response_model=RestoreStatus)
async def cancel_restore() -> RestoreStatus:
    """Cancel a staged restore so the next restart keeps the current database."""
    db_restore.cancel_pending(_db_path())
    return _restore_status()


@router.delete("/restore/result", response_model=RestoreStatus)
async def dismiss_restore_result() -> RestoreStatus:
    """Forget the last restore outcome (hides the notice in Settings)."""
    db_restore.dismiss_last_result(_db_path())
    return _restore_status()
