"""Tests for migration 135: per-contact flood-scope override."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration135:
    @pytest.mark.asyncio
    async def test_adds_a_null_override_to_existing_contacts(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 134)
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY, name TEXT)")
            await conn.execute("INSERT INTO contacts (public_key, name) VALUES ('aa', 'Alice')")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 134
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            row = await (await conn.execute("SELECT flood_scope_override FROM contacts")).fetchone()
            assert row["flood_scope_override"] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._135_contact_flood_scope_override import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
