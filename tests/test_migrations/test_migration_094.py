"""Tests for database migration 094: add sidebar_hidden column to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration094:
    """Test migration 094: add the sidebar_hidden overlay column."""

    @pytest.mark.asyncio
    async def test_adds_sidebar_hidden_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 094 so this migration (and any later ones) run.
            await set_version(conn, 93)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 93
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "sidebar_hidden" in columns

            # Default is an empty JSON object.
            async with conn.execute("SELECT sidebar_hidden FROM app_settings WHERE id = 1") as cur:
                row = await cur.fetchone()
            assert row["sidebar_hidden"] == "{}"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 93)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 93
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
