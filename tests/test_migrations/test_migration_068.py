"""Tests for database migration 068: add app_settings.registry_sync_url."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration068:
    @pytest.mark.asyncio
    async def test_adds_registry_sync_url_defaulting_empty(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 67)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 67
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("SELECT registry_sync_url FROM app_settings WHERE id = 1")
            row = await cursor.fetchone()
            assert row["registry_sync_url"] == ""
        finally:
            await conn.close()
