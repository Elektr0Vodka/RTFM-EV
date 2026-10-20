"""Tests for migration 163: retired wardrive drive uids."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._160_create_wardrive_tables import migrate as migrate_160
from app.migrations._161_create_wardrive_config import migrate as migrate_161
from app.migrations._162_create_wardrive_drives import migrate as migrate_162
from app.migrations._163_create_wardrive_drive_tombstones import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def test_creates_the_tombstone_table():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate_160(conn)
        await migrate_161(conn)
        await migrate_162(conn)
        await set_version(conn, 162)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 162
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert await _columns(conn, "wardrive_drive_tombstones") == {
            "uid",
            "user_id",
            "radio_key",
            "kind",
            "until_ts",
            "created_at",
        }


async def test_idempotent():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate(conn)
        await migrate(conn)
        assert "uid" in await _columns(conn, "wardrive_drive_tombstones")
