"""Tests for database migration 096: add packet_feed_sort column."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration096:
    """Test migration 096: add the packet-feed sort-direction column."""

    @pytest.mark.asyncio
    async def test_adds_packet_feed_sort_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 096 so this migration (and any later ones) run.
            await set_version(conn, 95)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 95
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "packet_feed_sort" in columns

            # Default is oldest-first (preserves existing behavior).
            async with conn.execute(
                "SELECT packet_feed_sort FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["packet_feed_sort"] == "oldest"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 95)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 95
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
