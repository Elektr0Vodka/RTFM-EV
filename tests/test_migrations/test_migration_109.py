"""Tests for database migration 109: add messages.failed_at."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration109:
    """Test migration 109: nullable failed marker on messages.

    Migration 108 is reserved by another branch, so these tests start from 107
    and count applied migrations through ``LATEST_SCHEMA_VERSION - start``,
    which tolerates the gap until 108 lands.
    """

    @pytest.mark.asyncio
    async def test_adds_nullable_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT, acked INTEGER)"
            )
            await conn.execute("INSERT INTO messages (id, text, acked) VALUES (1, 'hi', 0)")
            await conn.commit()
            await set_version(conn, 107)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 107
            assert applied >= 1
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT text, acked, failed_at FROM messages") as cur:
                row = await cur.fetchone()
            # Existing rows are "not failed" and keep their data.
            assert row["failed_at"] is None
            assert row["text"] == "hi"
            assert row["acked"] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._109_add_message_failed_at import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY)")
            await conn.commit()

            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(messages)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "failed_at" in columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_messages_absent(self):
        from app.migrations._109_add_message_failed_at import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            assert list(await cursor.fetchall()) == []
        finally:
            await conn.close()
