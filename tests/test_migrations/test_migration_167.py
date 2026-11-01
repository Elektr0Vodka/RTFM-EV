"""Tests for migration 167: the 'Hide by name pattern' chat filter."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._167_add_name_filter import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def _seed(conn: aiosqlite.Connection) -> None:
    await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
    await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
    await conn.execute("INSERT INTO messages (text) VALUES ('Adriaan257: hallo')")
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")


async def test_adds_the_flag_and_the_settings_with_everything_off():
    async with aiosqlite.connect(":memory:") as conn:
        await _seed(conn)
        await set_version(conn, 166)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 166
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        cursor = await conn.execute("SELECT name_filtered FROM messages")
        assert (await cursor.fetchone())[0] == 0
        cursor = await conn.execute(
            "SELECT name_filter_patterns, hide_name_filtered FROM app_settings"
        )
        assert tuple(await cursor.fetchone()) == ("[]", 0)


async def test_idempotent():
    async with aiosqlite.connect(":memory:") as conn:
        await _seed(conn)
        await migrate(conn)
        await migrate(conn)
        assert "name_filtered" in await _columns(conn, "messages")
        assert {"name_filter_patterns", "hide_name_filtered"} <= await _columns(
            conn, "app_settings"
        )


async def test_absent_tables_are_skipped():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate(conn)
        cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        assert await cursor.fetchall() == []
