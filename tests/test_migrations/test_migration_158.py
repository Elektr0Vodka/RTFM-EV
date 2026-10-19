"""Tests for migration 158: rx_bad_frames + app_settings.full_capture_flags."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._158_add_full_capture import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _names(conn: aiosqlite.Connection, kind: str) -> set[str]:
    rows = await (
        await conn.execute("SELECT name FROM sqlite_master WHERE type = ?", (kind,))
    ).fetchall()
    return {r[0] for r in rows}


async def _settings_columns(conn: aiosqlite.Connection) -> set[str]:
    return {c[1] for c in await (await conn.execute("PRAGMA table_info(app_settings)")).fetchall()}


@pytest.mark.asyncio
async def test_creates_table_and_flags_column():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
        await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
        await set_version(conn, 157)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 157
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        assert "rx_bad_frames" in await _names(conn, "table")
        assert "idx_rx_bad_frames_timestamp" in await _names(conn, "index")
        assert "full_capture_flags" in await _settings_columns(conn)
        row = await (await conn.execute("SELECT full_capture_flags FROM app_settings")).fetchone()
        assert row[0] == 0
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
        await migrate(conn)
        await migrate(conn)
        assert "rx_bad_frames" in await _names(conn, "table")
        assert "full_capture_flags" in await _settings_columns(conn)
    finally:
        await conn.close()
