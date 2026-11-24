"""Tests for migration 173: message bookmarks table."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._173_create_message_bookmarks import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration173:
    async def test_creates_table_and_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("PRAGMA table_info(message_bookmarks)")
            cols = {row["name"] for row in await cursor.fetchall()}
            assert cols == {"message_id", "note", "created_at"}
        finally:
            await conn.close()

    async def test_run_migrations_reaches_latest(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 172)
            await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
