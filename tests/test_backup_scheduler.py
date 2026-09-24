"""Scheduled backups: interval gating and keep-N rotation of automatic snapshots."""

import os
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from app.repository import AppSettingsRepository
from app.services import backup_scheduler
from app.services.backup_store import auto_backup_filename, list_backup_files


async def _enable(tmp_path, *, interval_hours: int = 24, keep: int = 7) -> None:
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path=str(tmp_path),
        backup_schedule_enabled=True,
        backup_schedule_interval_hours=interval_hours,
        backup_schedule_keep=keep,
    )


def _fake_auto(tmp_path, when: datetime) -> str:
    path = tmp_path / auto_backup_filename(when)
    path.write_bytes(b"placeholder")
    return path.name


@pytest.mark.asyncio
async def test_disabled_does_nothing(test_db, tmp_path):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True, backup_destination_path=str(tmp_path)
    )
    assert await backup_scheduler.run_scheduled_backup_once() is None
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_requires_server_path_enabled(test_db, tmp_path):
    await _enable(tmp_path)
    await AppSettingsRepository.update(backup_to_path_enabled=False)
    assert await backup_scheduler.run_scheduled_backup_once() is None
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_writes_snapshot_when_none_exists(test_db, tmp_path):
    async with test_db.tx() as conn:
        await conn.execute("CREATE TABLE t (id INTEGER)")
        await conn.execute("INSERT INTO t (id) VALUES (7)")
    await _enable(tmp_path)

    path = await backup_scheduler.run_scheduled_backup_once()

    assert path is not None
    assert os.path.basename(path).startswith("meshcore-auto-")
    snap = sqlite3.connect(path)
    assert snap.execute("SELECT id FROM t").fetchone()[0] == 7
    snap.close()


@pytest.mark.asyncio
async def test_skips_when_recent_snapshot_exists(test_db, tmp_path):
    await _enable(tmp_path, interval_hours=24)
    now = datetime.now(UTC)
    _fake_auto(tmp_path, now - timedelta(hours=2))
    assert await backup_scheduler.run_scheduled_backup_once(now=now) is None
    assert len(list(tmp_path.iterdir())) == 1


@pytest.mark.asyncio
async def test_runs_when_interval_elapsed(test_db, tmp_path):
    await _enable(tmp_path, interval_hours=6)
    now = datetime.now(UTC)
    _fake_auto(tmp_path, now - timedelta(hours=7))
    assert await backup_scheduler.run_scheduled_backup_once(now=now) is not None


@pytest.mark.asyncio
async def test_rotation_keeps_newest_autos_and_never_touches_manual(test_db, tmp_path):
    await _enable(tmp_path, interval_hours=1, keep=2)
    now = datetime.now(UTC)
    old = [_fake_auto(tmp_path, now - timedelta(days=d)) for d in (3, 2, 1)]
    manual = tmp_path / "meshcore-backup-20200101-000000.db"
    manual.write_bytes(b"manual")
    other = tmp_path / "notes.txt"
    other.write_text("keep me")

    new_path = await backup_scheduler.run_scheduled_backup_once(now=now)

    names = {p.name for p in tmp_path.iterdir()}
    assert os.path.basename(new_path) in names
    assert old[2] in names  # newest of the old autos survives
    assert old[0] not in names and old[1] not in names
    assert manual.name in names and other.name in names


@pytest.mark.asyncio
async def test_list_backup_files_classifies_kinds(tmp_path):
    now = datetime.now(UTC)
    auto = _fake_auto(tmp_path, now)
    (tmp_path / "meshcore-backup-20200101-000000.db").write_bytes(b"m")
    (tmp_path / "meshcore-pre-restore-20200101-000000.db").write_bytes(b"p")
    (tmp_path / "something.db").write_bytes(b"o")
    (tmp_path / "ignored.txt").write_text("x")

    files = {f["name"]: f["kind"] for f in list_backup_files(str(tmp_path))}

    assert files == {
        auto: "auto",
        "meshcore-backup-20200101-000000.db": "manual",
        "meshcore-pre-restore-20200101-000000.db": "pre-restore",
        "something.db": "other",
    }
