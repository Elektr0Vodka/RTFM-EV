"""Tests for migration 154: antenna_register_sites."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._154_create_antenna_register_sites import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection) -> set[str]:
    rows = await (await conn.execute("PRAGMA table_info(antenna_register_sites)")).fetchall()
    return {r[1] for r in rows}


@pytest.mark.asyncio
async def test_creates_table_and_index():
    conn = await aiosqlite.connect(":memory:")
    try:
        await set_version(conn, 153)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 153
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        assert {"id", "lat", "lon", "bands", "max_power_dbw", "transmitters", "synced_at"} <= (
            await _columns(conn)
        )
        index = await (
            await conn.execute(
                "SELECT name FROM sqlite_master WHERE name = 'idx_antenna_register_sites_bbox'"
            )
        ).fetchall()
        assert len(index) == 1
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        await conn.execute(
            "INSERT INTO antenna_register_sites (id, lat, lon, synced_at) VALUES (1, 52, 4, 1)"
        )
        await migrate(conn)
        row = await (await conn.execute("SELECT COUNT(*) FROM antenna_register_sites")).fetchone()
        assert row[0] == 1
    finally:
        await conn.close()
