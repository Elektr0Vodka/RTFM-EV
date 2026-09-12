"""Tests for database migration 078."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration078:
    """Test migration 078: add app_settings.auto_add_mentioned_channels."""

    @pytest.mark.asyncio
    async def test_adds_column_defaulting_disabled(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 77)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 77
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                "SELECT auto_add_mentioned_channels FROM app_settings WHERE id = 1"
            )
            row = await cursor.fetchone()
            # Existing rows default to disabled (NOT NULL DEFAULT 0).
            assert row["auto_add_mentioned_channels"] == 0
        finally:
            await conn.close()
