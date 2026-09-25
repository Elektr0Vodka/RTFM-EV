"""Tests for database migration 121: add hidden_hop_widths to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration121:
    @pytest.mark.asyncio
    async def test_adds_hidden_hop_widths_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await set_version(conn, 120)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 120
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute(
                "SELECT hidden_hop_widths FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            # Default: nothing hidden, the historical behaviour.
            assert row["hidden_hop_widths"] == "[]"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_without_app_settings(self):
        from app.migrations._121_add_hidden_hop_widths import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no app_settings table: no-op
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            assert "hidden_hop_widths" in {row[1] for row in await cursor.fetchall()}
        finally:
            await conn.close()
