"""Tests for migration 159: the wardrive plugin tables."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._159_create_wardrive_tables import RETENTION_COLUMN, migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

TABLES = {
    "wardrive_users",
    "wardrive_radios",
    "wardrive_groups",
    "wardrive_group_members",
    "wardrive_sessions",
    "wardrive_obs",
    "wardrive_tracks",
}


async def _names(conn: aiosqlite.Connection, kind: str) -> set[str]:
    rows = await (
        await conn.execute("SELECT name FROM sqlite_master WHERE type = ?", (kind,))
    ).fetchall()
    return {r[0] for r in rows}


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    return {c[1] for c in await (await conn.execute(f"PRAGMA table_info({table})")).fetchall()}


@pytest.mark.asyncio
async def test_creates_tables_and_retention_column():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
        await set_version(conn, 158)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 158
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        assert await _names(conn, "table") >= TABLES
        assert {
            "idx_wardrive_obs_rx_ts",
            "idx_wardrive_obs_user_rx_ts",
            "idx_wardrive_tracks_t0_ts",
        } <= await _names(conn, "index")
        assert RETENTION_COLUMN in await _columns(conn, "app_settings")
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent_and_without_app_settings():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        await migrate(conn)
        assert await _names(conn, "table") >= TABLES
    finally:
        await conn.close()
