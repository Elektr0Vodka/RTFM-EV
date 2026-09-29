"""Tests for database migration 122: add channel_sets to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration122:
    @pytest.mark.asyncio
    async def test_adds_channel_sets_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await set_version(conn, 121)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 121
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT channel_sets FROM app_settings WHERE id = 1") as cur:
                row = await cur.fetchone()
            # Default: no channel sets saved.
            assert row["channel_sets"] == "[]"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_without_app_settings(self):
        from app.migrations._122_add_channel_sets import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no app_settings table: no-op
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            assert "channel_sets" in {row[1] for row in await cursor.fetchall()}
        finally:
            await conn.close()
