"""Tests for migration 137: Spam Guard tables, the spam flag and its two settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn, table):
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1]: row for row in await cursor.fetchall()}


class TestMigration137:
    @pytest.mark.asyncio
    async def test_creates_tables_and_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)"
            )
            await conn.execute("INSERT INTO messages (text) VALUES ('hello')")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await set_version(conn, 136)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 136
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert set(await _columns(conn, "spam_guard_config")) == {
                "id",
                "version",
                "settings",
                "updated_at",
            }
            assert set(await _columns(conn, "spam_guard_state")) == {"id", "state", "updated_at"}
            assert set(await _columns(conn, "spam_evidence")) == {"id", "ts", "type", "data"}

            cursor = await conn.execute("SELECT spam FROM messages")
            assert [row["spam"] for row in await cursor.fetchall()] == [0]
            cursor = await conn.execute("SELECT spam_guard_enabled, hide_spam FROM app_settings")
            row = await cursor.fetchone()
            assert (row["spam_guard_enabled"], row["hide_spam"]) == (0, 0)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_tables(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 136)
            await conn.commit()
            await run_migrations(conn)
            cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'spam_%'"
            )
            assert {row[0] for row in await cursor.fetchall()} == {
                "spam_guard_config",
                "spam_guard_state",
                "spam_evidence",
            }

            from app.migrations._137_create_spam_guard import migrate

            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            assert "spam" in await _columns(conn, "messages")
        finally:
            await conn.close()
