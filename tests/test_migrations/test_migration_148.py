"""Tests for migration 148: the per-message columns behind the Spam & bots statistics."""

import aiosqlite
import pytest

from app.malformed import MESHCORE_DEFAULT_RTC_EPOCH
from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

NOW = 1_800_000_000
OLD_CLOCK = MESHCORE_DEFAULT_RTC_EPOCH + 60
GIBBERISH = "ŧ¸£Δ₁"

MESSAGES_147 = """
CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    type TEXT,
    text TEXT,
    sender_name TEXT,
    sender_timestamp INTEGER,
    received_at INTEGER,
    malformed INTEGER NOT NULL DEFAULT 0
)
"""


class TestMigration148:
    @pytest.mark.asyncio
    async def test_adds_the_columns_and_backfills_the_malformed_cause(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 147)
            await conn.execute(MESSAGES_147)
            await conn.executemany(
                "INSERT INTO messages (id, type, text, sender_name, sender_timestamp, "
                "received_at, malformed) VALUES (?, 'CHAN', ?, ?, ?, ?, ?)",
                [
                    (1, f"Bob: {GIBBERISH}", "Bob", NOW, NOW, 1),
                    (2, "Bob: hello", "Bob", OLD_CLOCK, NOW, 1),
                    (3, f"Bob: {GIBBERISH}", "Bob", OLD_CLOCK, NOW, 1),
                    (4, "Bob: hello", "Bob", NOW, NOW, 0),
                    # Flagged by an older rule; today's tests name no cause.
                    (5, "Bob: hello", "Bob", NOW, NOW, 1),
                    # No sender prefix to strip.
                    (6, GIBBERISH, None, NOW, NOW, 1),
                ],
            )
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 147
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            rows = await (await conn.execute("SELECT * FROM messages ORDER BY id")).fetchall()
            assert {row["id"]: row["malformed_reason"] for row in rows} == {
                1: "text",
                2: "clock",
                3: "both",
                4: None,
                5: None,
                6: "text",
            }
            first = rows[0]
            assert first["bot"] == 0
            assert (
                first["spam_outcome"],
                first["spam_block"],
                first["spam_enforced"],
                first["spam_label"],
            ) == (None, None, None, None)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._148_add_message_filter_stats import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute(MESSAGES_147)
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("PRAGMA table_info(messages)")
            names = [row[1] for row in await cursor.fetchall()]
            assert names.count("bot") == 1
            assert names.count("spam_label") == 1
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_does_not_backfill_again_when_the_column_exists(self):
        from app.migrations._148_add_message_filter_stats import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(MESSAGES_147)
            await migrate(conn)
            await conn.execute(
                "INSERT INTO messages (id, type, text, sender_name, sender_timestamp, "
                "received_at, malformed) VALUES (1, 'CHAN', ?, 'Bob', ?, ?, 1)",
                (f"Bob: {GIBBERISH}", NOW, NOW),
            )
            await migrate(conn)
            row = await (await conn.execute("SELECT malformed_reason FROM messages")).fetchone()
            assert row["malformed_reason"] is None
        finally:
            await conn.close()
