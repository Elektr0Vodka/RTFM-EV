"""Tests for migration 155: app_settings.external_map_source."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._155_add_external_map_source import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_APP_SETTINGS = """
    CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY,
        external_map_sync_url TEXT NOT NULL
            DEFAULT 'https://meshcore-analyzer.eu/api/nodes'
    )
"""


async def _source(conn: aiosqlite.Connection) -> str:
    row = await (await conn.execute("SELECT external_map_source FROM app_settings")).fetchone()
    return row[0]


async def _with_url(conn: aiosqlite.Connection, url: str) -> None:
    await conn.execute(_APP_SETTINGS)
    await conn.execute("INSERT INTO app_settings (id, external_map_sync_url) VALUES (1, ?)", (url,))
    await conn.commit()


@pytest.mark.asyncio
async def test_runs_from_154():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _with_url(conn, "https://meshcore-analyzer.eu/api/nodes")
        await set_version(conn, 154)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 154
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert await _source(conn) == "meshcore_map"
    finally:
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://meshcore-analyzer.eu/api/nodes", "meshcore_map"),  # old default
        ("", "meshcore_map"),
        ("https://analyzer.example.org/api/nodes", "analyzer"),  # user's own URL kept
    ],
)
async def test_existing_url_picks_source(url, expected):
    conn = await aiosqlite.connect(":memory:")
    try:
        await _with_url(conn, url)
        await migrate(conn)
        assert await _source(conn) == expected
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_skips_missing_table():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        tables = await (
            await conn.execute("SELECT name FROM sqlite_master WHERE name = 'app_settings'")
        ).fetchall()
        assert tables == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _with_url(conn, "https://analyzer.example.org/api/nodes")
        await migrate(conn)
        await conn.execute("UPDATE app_settings SET external_map_source = 'meshcore_map'")
        await conn.commit()
        await migrate(conn)  # column exists: leaves the user's choice alone
        assert await _source(conn) == "meshcore_map"
    finally:
        await conn.close()
