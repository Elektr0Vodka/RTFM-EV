"""Tests for database migration 104: add the map home-view columns."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration104:
    """Test migration 104: add map_home_mode/lat/lon/zoom columns."""

    @pytest.mark.asyncio
    async def test_adds_map_home_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 104 so only this migration runs.
            await set_version(conn, 103)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 103
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert {"map_home_mode", "map_home_lat", "map_home_lon", "map_home_zoom"} <= columns

            # Mode defaults to 'auto'; coordinates/zoom default to NULL.
            async with conn.execute(
                "SELECT map_home_mode, map_home_lat, map_home_lon, map_home_zoom "
                "FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["map_home_mode"] == "auto"
            assert row["map_home_lat"] is None
            assert row["map_home_lon"] is None
            assert row["map_home_zoom"] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 103)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 103
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
