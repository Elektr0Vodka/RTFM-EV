"""Tests for database migration 079."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration079:
    """Test migration 079: add app_settings.openhop_api_url + openhop_api_token."""

    @pytest.mark.asyncio
    async def test_adds_nullable_columns_defaulting_null(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 78)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 78
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                "SELECT openhop_api_url, openhop_api_token FROM app_settings WHERE id = 1"
            )
            row = await cursor.fetchone()
            # Existing rows default to unset (nullable TEXT, no default).
            assert row["openhop_api_url"] is None
            assert row["openhop_api_token"] is None
        finally:
            await conn.close()
