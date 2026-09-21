"""Tests for database migration 100: add mesh_health_page_size column."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration100:
    """Test migration 100: add the Mesh Health contacts-table page-size column."""

    @pytest.mark.asyncio
    async def test_adds_mesh_health_page_size_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 100 so only this migration runs.
            await set_version(conn, 99)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 99
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "mesh_health_page_size" in columns

            # Default is 50 rows per page (preserves the historical page size).
            async with conn.execute(
                "SELECT mesh_health_page_size FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["mesh_health_page_size"] == 50
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 99)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 99
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
