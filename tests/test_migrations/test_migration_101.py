"""Tests for database migration 101: add packet_group_by_content column."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration101:
    """Test migration 101: add the shared 'group repeats by content' toggle column."""

    @pytest.mark.asyncio
    async def test_adds_packet_group_by_content_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 100 so only the tail migrations run.
            await set_version(conn, 100)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 100
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "packet_group_by_content" in columns

            # Default is 0 (off): the historical behaviour.
            async with conn.execute(
                "SELECT packet_group_by_content FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["packet_group_by_content"] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 100)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 100
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
