"""Tests for migration 134: outcome of outgoing radio send commands."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_MESSAGES = """
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        text TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        outgoing INTEGER DEFAULT 0
    )
"""


class TestMigration134:
    @pytest.mark.asyncio
    async def test_adds_confirmed_send_status_to_existing_messages(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 133)
            await conn.execute(_MESSAGES)
            await conn.execute(
                "INSERT INTO messages (type, conversation_key, text, received_at, outgoing) "
                "VALUES ('PRIV', 'abc', 'hello', 1, 1)"
            )
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 133
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("SELECT send_status FROM messages")
            row = await cursor.fetchone()
            assert row["send_status"] == "confirmed"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._134_message_send_status import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute(_MESSAGES)
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
