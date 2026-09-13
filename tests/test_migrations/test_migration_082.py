"""Tests for database migration 082."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration082:
    """Test migration 082: add app_settings branding columns."""

    @pytest.mark.asyncio
    async def test_adds_branding_columns_with_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 81)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 81
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                "SELECT brand_name, brand_hidden, brand_icon FROM app_settings WHERE id = 1"
            )
            row = await cursor.fetchone()
            assert row["brand_name"] == ""
            assert row["brand_hidden"] == 0
            assert row["brand_icon"] == ""
        finally:
            await conn.close()
