"""Tests for database migration(s)."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration067:
    """Test migration 067: add app_settings.radio_presets."""

    @pytest.mark.asyncio
    async def test_adds_radio_presets_column_defaulting_empty(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 66)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 66
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("SELECT radio_presets FROM app_settings WHERE id = 1")
            row = await cursor.fetchone()
            # Existing rows default to empty string, meaning "never synced".
            assert row["radio_presets"] == ""
        finally:
            await conn.close()
