"""Tests for migration 171: messages.smaz (SMAZ-compressed on arrival)."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._171_add_message_smaz import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration171:
    async def test_adds_column_old_rows_unflagged_and_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.execute("INSERT INTO messages (id, text) VALUES (1, 'hello')")
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("SELECT smaz FROM messages")
            assert (await cursor.fetchone())["smaz"] == 0
        finally:
            await conn.close()

    async def test_no_messages_table_is_a_noop(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
        finally:
            await conn.close()

    async def test_run_migrations_reaches_latest(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 170)
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY)")
            await conn.commit()
            await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
