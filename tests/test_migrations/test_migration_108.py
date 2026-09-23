"""Tests for migration 108: battery chemistry (global default + per-contact override)."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration108:
    """Test migration 108: contacts.battery_chemistry + app_settings.battery_chemistry."""

    @pytest.mark.asyncio
    async def test_adds_columns_with_expected_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY, flags INTEGER)")
            await conn.execute("INSERT INTO contacts (public_key, flags) VALUES ('aa', 3)")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await set_version(conn, 107)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 107
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            async with conn.execute("SELECT battery_chemistry FROM contacts") as cur:
                row = await cur.fetchone()
            # Existing rows have no override: NULL means "use the global default".
            assert row["battery_chemistry"] is None

            async with conn.execute("SELECT battery_chemistry FROM app_settings") as cur:
                row = await cur.fetchone()
            assert row["battery_chemistry"] == "lipo"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._108_add_battery_chemistry import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(contacts)")
            contact_columns = {row["name"] for row in await cursor.fetchall()}
            assert "battery_chemistry" in contact_columns

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            settings_columns = {row["name"] for row in await cursor.fetchall()}
            assert "battery_chemistry" in settings_columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_tables_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 107)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 107
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
