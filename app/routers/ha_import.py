"""Import a RemoteTerm database from a Home Assistant backup (add-on mode only).

B2: the user makes a partial HA backup of the RemoteTerm add-on and picks it here.
B1: this add-on asks the Supervisor to make that backup, then the same path runs.
Both end in the normal restore staging (checks, snapshot of the current
database, swap on the next start), so nothing new touches the live database.

Every endpoint answers 404 outside add-on mode.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.database import db
from app.ha_addon.backup_import import (
    BackupImportError,
    check_upstream_schema,
    extract_database,
    is_remoteterm_addon,
    list_candidates,
)
from app.ha_addon.supervisor import (
    SupervisorUnavailable,
    remoteterm_slug_candidates,
    supervisor_client,
)
from app.routers.backup import RestoreStatus, _restore_status
from app.services import db_restore
from app.services.db_restore import RestoreValidationError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ha-import", tags=["ha-import"])

# Mapped read-only by the add-on config (map: backup).
HA_BACKUP_DIR = "/backup"


def _db_path() -> str:
    return db.db_path


def _require_addon_mode() -> None:
    if not settings.ha_addon:
        raise HTTPException(status_code=404, detail="Not running as a Home Assistant add-on")


class InstalledAddon(BaseModel):
    slug: str
    name: str


class HaBackup(BaseModel):
    backup_slug: str
    backup_name: str
    created: str
    addon_slug: str
    addon_name: str
    protected: bool


class HaImportStatus(BaseModel):
    installed: list[InstalledAddon]
    backups: list[HaBackup]
    database_empty: bool


class FromBackupRequest(BaseModel):
    backup_slug: str
    addon_slug: str


class MakeBackupRequest(BaseModel):
    addon_slug: str


class MakeBackupResult(BaseModel):
    backup_slug: str


async def _database_empty() -> bool:
    async with db.readonly() as conn:
        for table in ("contacts", "messages"):
            async with conn.execute(f"SELECT 1 FROM {table} LIMIT 1") as cursor:
                if await cursor.fetchone() is not None:
                    return False
    return True


@router.get("/status", response_model=HaImportStatus)
async def import_status() -> HaImportStatus:
    """Installed RemoteTerm add-ons, HA backups that hold one, and whether our database is empty."""
    _require_addon_mode()
    installed: list[InstalledAddon] = []
    client = supervisor_client()
    try:
        for slug in remoteterm_slug_candidates():
            info = await client.addon_info(slug)
            if info is not None:
                installed.append(InstalledAddon(slug=slug, name=str(info.get("name") or slug)))
    except SupervisorUnavailable as err:
        logger.info("HA import: Supervisor not reachable for the add-on lookup (%s)", err)
    candidates = await asyncio.to_thread(list_candidates, HA_BACKUP_DIR)
    return HaImportStatus(
        installed=installed,
        backups=[
            HaBackup(
                backup_slug=c.backup_slug,
                backup_name=c.backup_name,
                created=c.created,
                addon_slug=c.addon_slug,
                addon_name=c.addon_name,
                protected=c.protected,
            )
            for c in candidates
        ],
        database_empty=await _database_empty(),
    )


def _stage_from_backup(backup_path: str, addon_slug: str, backup_name: str) -> None:
    db_path = _db_path()
    data_dir = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(data_dir, exist_ok=True)
    work_dir = tempfile.mkdtemp(prefix="ha-import-", dir=data_dir)
    try:
        extracted = extract_database(backup_path, addon_slug, work_dir)
        check_upstream_schema(extracted)
        db_restore.stage_restore(
            extracted,
            db_path,
            source="ha-backup",
            original_name=backup_name or os.path.basename(backup_path),
            move=True,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/from-backup", response_model=RestoreStatus)
async def from_backup(request: FromBackupRequest) -> RestoreStatus:
    """Stage the RemoteTerm database from an HA backup; it is applied on the next start."""
    _require_addon_mode()
    candidates = await asyncio.to_thread(list_candidates, HA_BACKUP_DIR)
    match = next(
        (
            c
            for c in candidates
            if c.backup_slug == request.backup_slug and c.addon_slug == request.addon_slug
        ),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    try:
        await asyncio.to_thread(
            _stage_from_backup,
            os.path.join(HA_BACKUP_DIR, match.filename),
            match.addon_slug,
            match.backup_name,
        )
    except (BackupImportError, RestoreValidationError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except OSError as err:
        logger.exception("HA import: staging failed")
        raise HTTPException(status_code=500, detail="Failed to stage the import") from err
    return _restore_status()


@router.post("/make-backup", response_model=MakeBackupResult)
async def make_backup(request: MakeBackupRequest) -> MakeBackupResult:
    """Ask the Supervisor for an unencrypted partial backup of the RemoteTerm add-on."""
    _require_addon_mode()
    if not is_remoteterm_addon(request.addon_slug, ""):
        raise HTTPException(
            status_code=400, detail="Only the RemoteTerm add-on can be backed up here"
        )
    name = f"RTFM-EV import {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}"
    try:
        slug = await supervisor_client().create_partial_backup(request.addon_slug, name)
    except SupervisorUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    return MakeBackupResult(backup_slug=slug)


@router.post("/restart", status_code=202)
async def restart_addon() -> dict[str, str]:
    """Restart this add-on so a staged import is applied."""
    _require_addon_mode()
    try:
        await supervisor_client().restart_self()
    except SupervisorUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    return {"status": "restarting"}
