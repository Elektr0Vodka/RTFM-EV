"""Tests for database migration 106: add contacts.telemetry_perms."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration106:
    """Test migration 106: nullable per-contact telemetry permission column."""

    @pytest.mark.asyncio
    async def test_adds_nullable_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY, flags INTEGER)")
            await conn.execute("INSERT INTO contacts (public_key, flags) VALUES ('aa', 3)")
            await conn.commit()
            await set_version(conn, 105)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 105
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT flags, telemetry_perms FROM contacts") as cur:
                row = await cur.fetchone()
            # Existing rows stay "never set in the app" and keep their flags.
            assert row["telemetry_perms"] is None
            assert row["flags"] == 3
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._106_add_contact_telemetry_perms import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.commit()

            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(contacts)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "telemetry_perms" in columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_contacts_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 105)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 105
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
