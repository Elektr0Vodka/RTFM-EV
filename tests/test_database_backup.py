"""DatabaseManager.backup_to produces a consistent, valid snapshot."""

import sqlite3

import pytest

from app.database import Database


@pytest.mark.asyncio
async def test_backup_to_produces_valid_snapshot_with_same_rows(tmp_path):
    db = Database(":memory:")
    await db.connect()
    async with db.tx() as conn:
        await conn.execute("CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)")
        await conn.execute("INSERT INTO widget (name) VALUES ('a'), ('b'), ('c')")

    target = tmp_path / "snapshot.db"
    await db.backup_to(str(target))
    await db.disconnect()

    assert target.exists()
    snap = sqlite3.connect(str(target))
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert snap.execute("SELECT COUNT(*) FROM widget").fetchone()[0] == 3
    snap.close()


@pytest.mark.asyncio
async def test_backup_to_rejects_existing_target(tmp_path):
    db = Database(":memory:")
    await db.connect()
    target = tmp_path / "exists.db"
    target.write_text("occupied")
    with pytest.raises(sqlite3.DatabaseError):
        await db.backup_to(str(target))
    await db.disconnect()
