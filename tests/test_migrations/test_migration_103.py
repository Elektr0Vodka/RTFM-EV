"""Tests for database migration 103: add date_time_format column."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration103:
    """Test migration 103: add the UI date/time format column."""

    @pytest.mark.asyncio
    async def test_adds_date_time_format_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 103 so only this migration runs.
            await set_version(conn, 102)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 102
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "date_time_format" in columns

            # Default is 'auto' (follow the UI language).
            async with conn.execute(
                "SELECT date_time_format FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["date_time_format"] == "auto"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 102)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 102
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
