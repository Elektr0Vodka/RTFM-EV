"""Tests for migration 126: per-contact power source override."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration126:
    @pytest.mark.asyncio
    async def test_adds_nullable_power_source_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            await conn.commit()
            await set_version(conn, 125)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 125
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT power_source FROM contacts") as cur:
                row = await cur.fetchone()
            # Existing rows have no override: NULL means "auto" (detect from name).
            assert row["power_source"] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_table(self):
        from app.migrations._126_add_contact_power_source import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)  # no contacts table: no-op

            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(contacts)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert "power_source" in columns
        finally:
            await conn.close()
