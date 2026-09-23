"""Tests for database migration 111: add contact_groups column to app_settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration111:
    """Test migration 111: add the contact_groups column."""

    @pytest.mark.asyncio
    async def test_adds_contact_groups_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 111 so this migration (and any later ones) run.
            await set_version(conn, 110)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 110
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "contact_groups" in columns

            # Default is an empty JSON array.
            async with conn.execute("SELECT contact_groups FROM app_settings WHERE id = 1") as cur:
                row = await cur.fetchone()
            assert row["contact_groups"] == "[]"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 110)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 110
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._111_add_contact_groups import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = [row["name"] for row in await cursor.fetchall()]
            assert columns.count("contact_groups") == 1
        finally:
            await conn.close()
