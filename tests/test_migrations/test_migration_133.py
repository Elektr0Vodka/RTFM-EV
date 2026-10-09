"""Tests for migration 133: message-ID tie-breaker for read-state timestamps."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_SCHEMA = """
    CREATE TABLE contacts (
        public_key TEXT PRIMARY KEY,
        last_read_at INTEGER
    );
    CREATE TABLE channels (
        key TEXT PRIMARY KEY,
        last_read_at INTEGER
    );
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        text TEXT NOT NULL,
        received_at INTEGER NOT NULL
    );
    INSERT INTO contacts (public_key, last_read_at) VALUES ('alice', 100);
    INSERT INTO contacts (public_key, last_read_at) VALUES ('never-read', NULL);
    INSERT INTO channels (key, last_read_at) VALUES ('PUBLIC', 100);
    INSERT INTO messages (type, conversation_key, text, received_at)
        VALUES ('PRIV', 'alice', 'read dm', 100);
    INSERT INTO messages (type, conversation_key, text, received_at)
        VALUES ('PRIV', 'alice', 'unread dm', 101);
    INSERT INTO messages (type, conversation_key, text, received_at)
        VALUES ('CHAN', 'PUBLIC', 'read channel', 100);
    INSERT INTO messages (type, conversation_key, text, received_at)
        VALUES ('CHAN', 'PUBLIC', 'unread channel', 101);
"""


async def _cursor(conn, table, key_column, key):
    row = await (
        await conn.execute(
            f"SELECT last_read_message_id FROM {table} WHERE {key_column} = ?", (key,)
        )
    ).fetchone()
    return row["last_read_message_id"]


class TestMigration133:
    @pytest.mark.asyncio
    async def test_adds_and_backfills_read_message_cursors(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 132)
            await conn.executescript(_SCHEMA)
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 132
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            # Everything from the boundary second counted as read before, so the
            # cursor is seeded past it and no old message turns unread.
            assert await _cursor(conn, "contacts", "public_key", "alice") == 1
            assert await _cursor(conn, "channels", "key", "PUBLIC") == 3
            assert await _cursor(conn, "contacts", "public_key", "never-read") is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_keeps_an_advanced_cursor(self):
        from app.migrations._133_add_read_message_cursor import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.executescript(_SCHEMA)
            await migrate(conn)
            await conn.execute("UPDATE channels SET last_read_message_id = 4")
            await conn.commit()
            await migrate(conn)

            assert await _cursor(conn, "channels", "key", "PUBLIC") == 4
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_absent_tables(self):
        from app.migrations._133_add_read_message_cursor import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
        finally:
            await conn.close()
