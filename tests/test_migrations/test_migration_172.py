"""Tests for migration 172: messages.app_payload for MCOimg v3 pictures."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._172_add_message_app_payload import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration172:
    async def test_adds_nullable_column_and_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.execute("INSERT INTO messages (id, text) VALUES (1, 'hi')")
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("SELECT app_payload FROM messages")
            assert (await cursor.fetchone())["app_payload"] is None
            await conn.execute("UPDATE messages SET app_payload = ? WHERE id = 1", (b"\x13\x00",))
            cursor = await conn.execute("SELECT app_payload FROM messages")
            assert (await cursor.fetchone())["app_payload"] == b"\x13\x00"
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
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 171)
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.commit()
            await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
