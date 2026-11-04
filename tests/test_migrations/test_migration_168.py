"""Tests for migration 168: antenna_test_runs."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._168_create_antenna_test_runs import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def test_creates_the_table():
    async with aiosqlite.connect(":memory:") as conn:
        await set_version(conn, 167)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 167
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert await _columns(conn, "antenna_test_runs") == {
            "id",
            "antenna",
            "notes",
            "radio_public_key",
            "radio_name",
            "traces_per_node",
            "started_at",
            "finished_at",
            "results",
        }


async def test_idempotent():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate(conn)
        await conn.execute(
            "INSERT INTO antenna_test_runs (antenna, traces_per_node, started_at, finished_at) "
            "VALUES ('whip', 3, 1, 2)"
        )
        await migrate(conn)
        cursor = await conn.execute("SELECT antenna, notes, results FROM antenna_test_runs")
        assert tuple(await cursor.fetchone()) == ("whip", "", "[]")
