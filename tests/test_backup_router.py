"""Backup router: download snapshot and save-to-path behaviour."""

import sqlite3

import pytest
from fastapi import HTTPException

from app.repository import AppSettingsRepository
from app.routers.backup import download_backup, save_backup


@pytest.mark.asyncio
async def test_download_returns_valid_sqlite_file(test_db):
    async with test_db.tx() as conn:
        await conn.execute("CREATE TABLE t (id INTEGER)")
        await conn.execute("INSERT INTO t (id) VALUES (1), (2)")

    response = await download_backup()
    assert response.media_type == "application/octet-stream"
    assert "attachment" in response.headers["content-disposition"]
    assert response.filename.startswith("meshcore-backup-")
    assert response.filename.endswith(".db")

    snap = sqlite3.connect(response.path)
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert snap.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 2
    snap.close()


@pytest.mark.asyncio
async def test_save_writes_to_configured_dir(test_db, tmp_path):
    async with test_db.tx() as conn:
        await conn.execute("CREATE TABLE t (id INTEGER)")
        await conn.execute("INSERT INTO t (id) VALUES (1)")
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path=str(tmp_path),
    )

    result = await save_backup()
    assert result.size_bytes > 0
    assert result.path.startswith(str(tmp_path))
    snap = sqlite3.connect(result.path)
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    snap.close()


@pytest.mark.asyncio
async def test_save_rejected_when_disabled(test_db, tmp_path):
    await AppSettingsRepository.update(
        backup_to_path_enabled=False,
        backup_destination_path=str(tmp_path),
    )
    with pytest.raises(HTTPException) as exc:
        await save_backup()
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_save_rejected_for_invalid_path(test_db):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path="relative/not/absolute",
    )
    with pytest.raises(HTTPException) as exc:
        await save_backup()
    assert exc.value.status_code == 400
