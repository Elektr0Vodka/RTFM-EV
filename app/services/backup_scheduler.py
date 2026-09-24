import asyncio
import logging
import os
from datetime import UTC, datetime

from app.database import db
from app.repository import AppSettingsRepository
from app.services.backup_store import (
    BackupDirError,
    auto_backup_filename,
    auto_backup_times,
    resolve_backup_dir,
    rotate_auto_backups,
)

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 300
_backup_task: asyncio.Task | None = None


async def run_scheduled_backup_once(now: datetime | None = None) -> str | None:
    """Write an automatic snapshot if one is due. Returns its path, else None.

    Due means no ``meshcore-auto-*.db`` in the backup directory is younger than
    the configured interval (the timestamp comes from the file name, so a
    restart does not trigger an extra snapshot). Requires both the schedule and
    the server-side backup directory to be enabled. Reads settings each call.
    """
    settings = await AppSettingsRepository.get()
    if not settings.backup_schedule_enabled or not settings.backup_to_path_enabled:
        return None
    try:
        dest = resolve_backup_dir(settings)
    except BackupDirError as err:
        logger.warning("Scheduled backup skipped: %s", err.detail)
        return None

    now = now or datetime.now(UTC)
    autos = auto_backup_times(dest)
    interval_seconds = max(1, settings.backup_schedule_interval_hours) * 3600
    if autos and (now - autos[-1][0]).total_seconds() < interval_seconds:
        return None

    target = os.path.join(dest, auto_backup_filename(now))
    await db.backup_to(target)
    deleted = rotate_auto_backups(dest, settings.backup_schedule_keep)
    logger.info(
        "Wrote scheduled backup %s (%d older automatic backup(s) removed)", target, len(deleted)
    )
    return target


async def _backup_loop() -> None:
    # First check shortly after startup, then every few minutes.
    await asyncio.sleep(60)
    while True:
        try:
            await run_scheduled_backup_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Error in scheduled backup loop: %s", e, exc_info=True)
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


def start_backup_schedule() -> None:
    global _backup_task
    if _backup_task is None or _backup_task.done():
        _backup_task = asyncio.create_task(_backup_loop())
        logger.info("Started scheduled backup loop")


async def stop_backup_schedule() -> None:
    global _backup_task
    if _backup_task and not _backup_task.done():
        _backup_task.cancel()
        try:
            await _backup_task
        except asyncio.CancelledError:
            pass
        _backup_task = None
        logger.info("Stopped scheduled backup loop")
