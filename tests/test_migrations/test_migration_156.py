"""Tests for migration 156: antenna_register_sites.max_height_m."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._156_add_antenna_register_max_height import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_TABLE = """
    CREATE TABLE antenna_register_sites (
        id INTEGER PRIMARY KEY,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        municipality TEXT NOT NULL DEFAULT '',
        postcode TEXT NOT NULL DEFAULT '',
        place TEXT NOT NULL DEFAULT '',
        kinds TEXT NOT NULL DEFAULT '',
        bands TEXT NOT NULL DEFAULT '',
        max_power_dbw REAL,
        transmitters TEXT NOT NULL DEFAULT '[]',
        synced_at INTEGER NOT NULL
    )
"""


async def _columns(conn: aiosqlite.Connection) -> set[str]:
    rows = await (await conn.execute("PRAGMA table_info(antenna_register_sites)")).fetchall()
    return {r[1] for r in rows}


@pytest.mark.asyncio
async def test_adds_column_and_backfills_from_transmitters():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute(_TABLE)
        await conn.execute(
            "INSERT INTO antenna_register_sites (id, lat, lon, transmitters, synced_at) VALUES "
            """(1, 52, 4, '[{"height_m": 25.2}, {"height_m": 31.5}, {"height_m": null}]', 1),"""
            "(2, 52, 4, '[]', 1)"
        )
        await set_version(conn, 155)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 155
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert "max_height_m" in await _columns(conn)
        rows = await (
            await conn.execute("SELECT id, max_height_m FROM antenna_register_sites ORDER BY id")
        ).fetchall()
        assert [tuple(r) for r in rows] == [(1, 31.5), (2, None)]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_skips_missing_table():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        tables = await (
            await conn.execute(
                "SELECT name FROM sqlite_master WHERE name = 'antenna_register_sites'"
            )
        ).fetchall()
        assert tables == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute(_TABLE)
        await migrate(conn)
        await migrate(conn)
        assert "max_height_m" in await _columns(conn)
    finally:
        await conn.close()
