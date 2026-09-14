"""Tests for database migration 092: add handy_info column to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration092:
    """Test migration 092: add the handy_info overlay column."""

    @pytest.mark.asyncio
    async def test_adds_handy_info_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 092 so only this migration runs.
            await set_version(conn, LATEST_SCHEMA_VERSION - 1)

            applied = await run_migrations(conn)

            assert applied == 1
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "handy_info" in columns

            # Default is an empty JSON object.
            async with conn.execute("SELECT handy_info FROM app_settings WHERE id = 1") as cur:
                row = await cur.fetchone()
            assert row["handy_info"] == "{}"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, LATEST_SCHEMA_VERSION - 1)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == 1
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
