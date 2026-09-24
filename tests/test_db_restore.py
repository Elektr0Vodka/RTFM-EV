"""Database restore: validate + stage a backup, swap it in at startup."""

import os
import sqlite3

import pytest

from app.migrations import latest_version
from app.services import db_restore
from app.services.db_restore import RestoreValidationError


def _make_db(path, *, marker: str = "old", user_version: int | None = None) -> None:
    """Create a minimal RemoteTerm-shaped SQLite file with a marker row."""
    conn = sqlite3.connect(path)
    for table in ("contacts", "channels", "messages", "app_settings"):
        conn.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, note TEXT)")
    conn.execute("INSERT INTO app_settings (id, note) VALUES (1, ?)", (marker,))
    conn.execute(f"PRAGMA user_version = {user_version if user_version is not None else 1}")
    conn.commit()
    conn.close()


def _marker(path) -> str:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT note FROM app_settings WHERE id = 1").fetchone()[0]
    finally:
        conn.close()


class TestValidate:
    def test_accepts_remoteterm_db(self, tmp_path):
        path = tmp_path / "ok.db"
        _make_db(path, user_version=42)
        assert db_restore.validate_backup_file(str(path)) == 42

    def test_rejects_non_sqlite(self, tmp_path):
        path = tmp_path / "junk.db"
        path.write_bytes(b"definitely not sqlite" * 20)
        with pytest.raises(RestoreValidationError, match="not a SQLite database"):
            db_restore.validate_backup_file(str(path))

    def test_rejects_sqlite_without_remoteterm_tables(self, tmp_path):
        path = tmp_path / "other.db"
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE unrelated (id INTEGER)")
        conn.commit()
        conn.close()
        with pytest.raises(RestoreValidationError, match="not a RemoteTerm database"):
            db_restore.validate_backup_file(str(path))

    def test_rejects_newer_schema(self, tmp_path):
        path = tmp_path / "future.db"
        _make_db(path, user_version=latest_version() + 1)
        with pytest.raises(RestoreValidationError, match="newer version"):
            db_restore.validate_backup_file(str(path))


class TestStage:
    def test_stage_copies_and_records_meta(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        _make_db(db_path, marker="live")
        src = tmp_path / "backup.db"
        _make_db(src, marker="backup")

        pending = db_restore.stage_restore(
            str(src), db_path, source="server", original_name="backup.db"
        )

        assert pending["source"] == "server"
        assert pending["original_name"] == "backup.db"
        assert pending["size_bytes"] > 0
        assert os.path.exists(db_path + db_restore.PENDING_SUFFIX)
        assert src.exists()  # copy, not move
        assert db_restore.get_pending(db_path)["original_name"] == "backup.db"
        # Live DB untouched until restart.
        assert _marker(db_path) == "live"

    def test_stage_move_removes_source(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        src = tmp_path / "upload.tmp"
        _make_db(src, marker="backup")
        db_restore.stage_restore(
            str(src), db_path, source="upload", original_name="mine.db", move=True
        )
        assert not src.exists()
        assert db_restore.get_pending(db_path) is not None

    def test_invalid_file_is_not_staged(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        src = tmp_path / "junk.db"
        src.write_bytes(b"x" * 500)
        with pytest.raises(RestoreValidationError):
            db_restore.stage_restore(str(src), db_path, source="upload", original_name="junk.db")
        assert db_restore.get_pending(db_path) is None
        assert not any(p.name.startswith("meshcore.db.restore") for p in tmp_path.iterdir())

    def test_cancel_removes_pending(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        src = tmp_path / "backup.db"
        _make_db(src)
        db_restore.stage_restore(str(src), db_path, source="server", original_name="b.db")
        assert db_restore.cancel_pending(db_path) is True
        assert db_restore.get_pending(db_path) is None
        assert db_restore.cancel_pending(db_path) is False


class TestApply:
    def test_no_pending_is_noop(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        _make_db(db_path, marker="live")
        assert db_restore.apply_pending_restore(db_path) is None
        assert _marker(db_path) == "live"

    def test_swaps_in_backup_and_snapshots_previous(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        _make_db(db_path, marker="live")
        src = tmp_path / "backup.db"
        _make_db(src, marker="backup")
        db_restore.stage_restore(str(src), db_path, source="upload", original_name="b.db")
        # Stale WAL/SHM from the old database must not be applied to the new one.
        (tmp_path / "meshcore.db-wal").write_bytes(b"stale")
        (tmp_path / "meshcore.db-shm").write_bytes(b"stale")

        result = db_restore.apply_pending_restore(db_path)

        assert result is not None and result["ok"] is True
        assert _marker(db_path) == "backup"
        snapshot = result["pre_restore_snapshot"]
        assert snapshot and os.path.basename(snapshot).startswith("meshcore-pre-restore-")
        assert _marker(snapshot) == "live"
        assert not (tmp_path / "meshcore.db-wal").exists()
        assert not (tmp_path / "meshcore.db-shm").exists()
        assert db_restore.get_pending(db_path) is None
        last = db_restore.get_last_result(db_path)
        assert last is not None and last["ok"] is True
        assert last["original_name"] == "b.db"

    def test_failed_validation_keeps_live_db(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        _make_db(db_path, marker="live")
        src = tmp_path / "backup.db"
        _make_db(src, marker="backup")
        db_restore.stage_restore(str(src), db_path, source="upload", original_name="b.db")
        # Corrupt the staged file after staging.
        with open(db_path + db_restore.PENDING_SUFFIX, "wb") as fh:
            fh.write(b"corrupted" * 50)

        result = db_restore.apply_pending_restore(db_path)

        assert result is not None and result["ok"] is False
        assert result["error"]
        assert _marker(db_path) == "live"
        assert db_restore.get_pending(db_path) is None
        # Not retried on every startup.
        assert db_restore.apply_pending_restore(db_path) is None

    def test_restore_without_existing_db(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        src = tmp_path / "backup.db"
        _make_db(src, marker="backup")
        db_restore.stage_restore(str(src), db_path, source="upload", original_name="b.db")

        result = db_restore.apply_pending_restore(db_path)

        assert result is not None and result["ok"] is True
        assert result["pre_restore_snapshot"] is None
        assert _marker(db_path) == "backup"

    def test_dismiss_result(self, tmp_path):
        db_path = str(tmp_path / "meshcore.db")
        src = tmp_path / "backup.db"
        _make_db(src)
        db_restore.stage_restore(str(src), db_path, source="upload", original_name="b.db")
        db_restore.apply_pending_restore(db_path)
        assert db_restore.dismiss_last_result(db_path) is True
        assert db_restore.get_last_result(db_path) is None
