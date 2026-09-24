"""Backup router: download snapshot and save-to-path behaviour."""

import io
import os
import sqlite3

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.repository import AppSettingsRepository
from app.routers.backup import (
    RestoreFromServerRequest,
    cancel_restore,
    download_backup,
    get_restore_status,
    list_backup_files_endpoint,
    restore_from_server,
    restore_from_upload,
    save_backup,
)


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


# --- Restore + server file listing -------------------------------------------


def _make_remoteterm_db(path, marker="backup"):
    conn = sqlite3.connect(path)
    for table in ("contacts", "channels", "messages", "app_settings"):
        conn.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, note TEXT)")
    conn.execute("INSERT INTO app_settings (id, note) VALUES (1, ?)", (marker,))
    conn.commit()
    conn.close()


@pytest.fixture
def live_db_path(tmp_path, monkeypatch):
    """Point the router's restore staging at a file path (tests use :memory:)."""
    import app.routers.backup as backup_module

    (tmp_path / "data").mkdir()
    path = str(tmp_path / "data" / "meshcore.db")
    monkeypatch.setattr(backup_module, "_db_path", lambda: path)
    return path


@pytest.mark.asyncio
async def test_list_files_when_disabled(test_db):
    result = await list_backup_files_endpoint()
    assert result.enabled is False
    assert result.files == []


@pytest.mark.asyncio
async def test_list_files_in_configured_dir(test_db, tmp_path):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True, backup_destination_path=str(tmp_path)
    )
    await save_backup()
    (tmp_path / "readme.txt").write_text("not a backup")

    result = await list_backup_files_endpoint()
    assert result.enabled is True
    assert result.error is None
    assert [f.kind for f in result.files] == ["manual"]


@pytest.mark.asyncio
async def test_restore_from_server_stages_file(test_db, tmp_path, live_db_path):
    backups = tmp_path / "backups"
    backups.mkdir()
    _make_remoteterm_db(backups / "old.db")
    await AppSettingsRepository.update(
        backup_to_path_enabled=True, backup_destination_path=str(backups)
    )

    status = await restore_from_server(RestoreFromServerRequest(filename="old.db"))
    assert status.pending is not None
    assert status.pending.source == "server"
    assert status.pending.original_name == "old.db"
    assert (await get_restore_status()).pending is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["../x.db", "sub/x.db", "..", "x.txt", "missing.db"])
async def test_restore_from_server_rejects_bad_names(test_db, tmp_path, live_db_path, name):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True, backup_destination_path=str(tmp_path)
    )
    with pytest.raises(HTTPException) as exc:
        await restore_from_server(RestoreFromServerRequest(filename=name))
    assert exc.value.status_code in (400, 404)


@pytest.mark.asyncio
async def test_restore_from_server_rejects_invalid_db(test_db, tmp_path, live_db_path):
    (tmp_path / "junk.db").write_bytes(b"junk" * 100)
    await AppSettingsRepository.update(
        backup_to_path_enabled=True, backup_destination_path=str(tmp_path)
    )
    with pytest.raises(HTTPException) as exc:
        await restore_from_server(RestoreFromServerRequest(filename="junk.db"))
    assert exc.value.status_code == 400
    assert "SQLite" in exc.value.detail


@pytest.mark.asyncio
async def test_upload_stages_and_cancel_clears(test_db, tmp_path, live_db_path):
    src = tmp_path / "upload.db"
    _make_remoteterm_db(src)
    upload = UploadFile(file=io.BytesIO(src.read_bytes()), filename="my-backup.db")

    status = await restore_from_upload(upload)
    assert status.pending is not None
    assert status.pending.source == "upload"
    assert status.pending.original_name == "my-backup.db"
    # The temporary upload file does not linger next to the database.
    assert sorted(os.listdir(os.path.dirname(live_db_path))) == [
        "meshcore.db.restore-pending",
        "meshcore.db.restore-pending.json",
    ]

    status = await cancel_restore()
    assert status.pending is None


@pytest.mark.asyncio
async def test_upload_rejects_non_database(test_db, live_db_path):
    upload = UploadFile(file=io.BytesIO(b"hello" * 100), filename="x.db")
    with pytest.raises(HTTPException) as exc:
        await restore_from_upload(upload)
    assert exc.value.status_code == 400
    assert (await get_restore_status()).pending is None
    assert os.listdir(os.path.dirname(live_db_path)) == []
