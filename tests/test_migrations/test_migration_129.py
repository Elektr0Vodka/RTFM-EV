"""Tests for migration 129: malformed message flag and the hide_malformed setting."""

import aiosqlite
import pytest

from app.malformed import MESHCORE_DEFAULT_RTC_EPOCH
from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

NOW = 1791220000

_MESSAGES_SCHEMA = """
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    text TEXT NOT NULL,
    sender_timestamp INTEGER,
    received_at INTEGER NOT NULL,
    txt_type INTEGER DEFAULT 0,
    outgoing INTEGER DEFAULT 0,
    sender_name TEXT
)
"""


async def _insert(conn, text, *, msg_type="CHAN", sender=None, ts=NOW, outgoing=0, txt_type=0):
    cursor = await conn.execute(
        "INSERT INTO messages (type, conversation_key, text, sender_timestamp, received_at,"
        " txt_type, outgoing, sender_name) VALUES (?, 'k', ?, ?, ?, ?, ?, ?)",
        (msg_type, text, ts, NOW, txt_type, outgoing, sender),
    )
    return cursor.lastrowid


class TestMigration129:
    @pytest.mark.asyncio
    async def test_adds_columns_and_backfills_existing_messages(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(_MESSAGES_SCHEMA)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")

            default_clock = MESHCORE_DEFAULT_RTC_EPOCH + 60
            expected = {
                await _insert(conn, "Sam.2pup: ヂχ\U0004f373Р", sender="Sam.2pup"): 1,
                await _insert(conn, "Ed186-a1vtn: ŧ¸£Δ₁", sender="Ed186-a1vtn"): 1,
                # Plain text, but the sender clock never left the firmware default.
                await _insert(conn, "Node: hello", sender="Node", ts=default_clock): 1,
                await _insert(conn, "Friend: goedenavond", sender="Friend"): 0,
                await _insert(conn, "Friend: 👍", sender="Friend"): 0,
                # A non-ASCII sender name alone does not make the body gibberish.
                await _insert(conn, "Ωmega: привет", sender="Ωmega"): 0,
                # Not incoming channel text: left alone whatever the content.
                await _insert(conn, "Me: ŧ¸£Δ₁", sender="Me", outgoing=1): 0,
                await _insert(conn, "ŧ¸£Δ₁", msg_type="PRIV"): 0,
                await _insert(conn, "[data] type=0x0001 len=4", ts=default_clock, txt_type=0x40): 0,
            }
            await conn.commit()
            await set_version(conn, 128)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 128
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT id, malformed FROM messages") as cur:
                actual = {row["id"]: row["malformed"] for row in await cur.fetchall()}
            assert actual == expected
            async with conn.execute("SELECT hide_malformed FROM app_settings") as cur:
                row = await cur.fetchone()
            # Off by default: nothing is hidden until the filter is enabled.
            assert row["hide_malformed"] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_tables(self):
        from app.migrations._129_add_malformed_message_flag import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)  # neither table exists: no-op

            # A minimal messages table lacks the columns the backfill reads.
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.execute("INSERT INTO messages (text) VALUES ('ŧ¸£Δ₁')")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            async with conn.execute("SELECT malformed FROM messages") as cur:
                assert (await cur.fetchone())["malformed"] == 0
            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            assert "hide_malformed" in {row["name"] for row in await cursor.fetchall()}
        finally:
            await conn.close()
