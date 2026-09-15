"""Tests for database migration 093: add sidebar order columns to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration093:
    """Test migration 093: add the three sidebar drag-order columns."""

    @pytest.mark.asyncio
    async def test_adds_sidebar_order_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 093 so this migration (and any later ones) run.
            await set_version(conn, 92)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 92
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "sidebar_section_order" in columns
            assert "sidebar_tool_order" in columns
            assert "sidebar_favorites_order" in columns

            # Default is an empty string (unset -> client falls back to defaults).
            async with conn.execute(
                "SELECT sidebar_section_order, sidebar_tool_order, sidebar_favorites_order "
                "FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["sidebar_section_order"] == ""
            assert row["sidebar_tool_order"] == ""
            assert row["sidebar_favorites_order"] == ""
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 92)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 92
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
