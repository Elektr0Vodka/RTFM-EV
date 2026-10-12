"""Tests for migration 140: the Spam Guard duplicate marker on messages."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration140:
    @pytest.mark.asyncio
    async def test_adds_the_column_and_keeps_existing_rows(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 139)
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.execute("INSERT INTO messages (text) VALUES ('hello')")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 139
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            row = await (await conn.execute("SELECT text, duplicate FROM messages")).fetchone()
            assert tuple(row) == ("hello", 0)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._140_add_duplicate_message_flag import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
