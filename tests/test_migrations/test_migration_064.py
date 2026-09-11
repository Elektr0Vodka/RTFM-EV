"""Tests for database migration(s)."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration064:
    """Test migration 064: add app_settings.show_mention_ticker."""

    @pytest.mark.asyncio
    async def test_adds_show_mention_ticker_column_defaulting_enabled(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 63)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 63
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("SELECT show_mention_ticker FROM app_settings WHERE id = 1")
            row = await cursor.fetchone()
            # Existing rows default to enabled (NOT NULL DEFAULT 1).
            assert row["show_mention_ticker"] == 1
        finally:
            await conn.close()
