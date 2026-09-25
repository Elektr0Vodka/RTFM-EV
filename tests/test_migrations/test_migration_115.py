"""Tests for database migration 115: create contact_path_outcomes."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration115:
    @pytest.mark.asyncio
    async def test_creates_table_with_unique_route_key(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            await set_version(conn, 114)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 114
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            await conn.execute(
                "INSERT INTO contact_path_outcomes (public_key, path_hex, path_len, first_used, last_used) "
                "VALUES ('aa', '11', 1, 1, 1)"
            )
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(
                    "INSERT INTO contact_path_outcomes (public_key, path_hex, path_len, first_used, last_used) "
                    "VALUES ('aa', '11', 1, 2, 2)"
                )
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 114)
            await conn.commit()
            await run_migrations(conn)
            from app.migrations._115_create_contact_path_outcomes import migrate

            await migrate(conn)
        finally:
            await conn.close()
