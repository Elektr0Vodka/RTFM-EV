"""Tests for migration 128: contact vessel type and TEAM beacon settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration128:
    @pytest.mark.asyncio
    async def test_adds_vessel_type_and_team_beacon_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await set_version(conn, 127)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 127
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT vessel_type FROM contacts") as cur:
                row = await cur.fetchone()
            # Existing rows have no vessel type.
            assert row["vessel_type"] is None
            async with conn.execute("SELECT team_beacon FROM app_settings") as cur:
                row = await cur.fetchone()
            # Empty JSON object: the periodic beacon is off until configured.
            assert row["team_beacon"] == "{}"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_tables(self):
        from app.migrations._128_add_team_vessel_type_and_beacon import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)  # neither table exists: no-op

            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(contacts)")
            assert "vessel_type" in {row["name"] for row in await cursor.fetchall()}
            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            assert "team_beacon" in {row["name"] for row in await cursor.fetchall()}
        finally:
            await conn.close()
