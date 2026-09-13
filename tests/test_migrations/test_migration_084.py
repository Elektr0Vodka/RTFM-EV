"""Migration 084: adds backup settings columns to app_settings."""

import aiosqlite
import pytest

from app.migrations._084_add_backup_settings import migrate


@pytest.mark.asyncio
async def test_adds_backup_columns_with_defaults():
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1))")
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.commit()

    await migrate(conn)

    cur = await conn.execute("PRAGMA table_info(app_settings)")
    cols = {row[1] for row in await cur.fetchall()}
    assert "backup_to_path_enabled" in cols
    assert "backup_destination_path" in cols

    cur = await conn.execute(
        "SELECT backup_to_path_enabled, backup_destination_path FROM app_settings WHERE id = 1"
    )
    row = await cur.fetchone()
    assert row["backup_to_path_enabled"] == 0
    assert row["backup_destination_path"] == ""
    await conn.close()


@pytest.mark.asyncio
async def test_is_idempotent():
    conn = await aiosqlite.connect(":memory:")
    await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1))")
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.commit()

    await migrate(conn)
    await migrate(conn)  # second run must not raise

    cur = await conn.execute("PRAGMA table_info(app_settings)")
    cols = [row[1] for row in await cur.fetchall()]
    assert cols.count("backup_to_path_enabled") == 1
    await conn.close()
