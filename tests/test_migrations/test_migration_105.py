"""Tests for database migration 105: add the per-class retention settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

EXPECTED = {
    "retention_prune_interval_hours": 24,
    "telemetry_retention_days": 30,
    "telemetry_max_rows_per_node": 1000,
    "link_signal_retention_days": 30,
    "advert_paths_per_contact": 10,
    "noise_floor_retention_days": 0,
    "battery_retention_days": 0,
    "airtime_retention_days": 0,
    "message_retention_days": 0,
}


class TestMigration105:
    """Test migration 105: retention columns on app_settings."""

    @pytest.mark.asyncio
    async def test_adds_retention_columns_with_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await set_version(conn, 104)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 104
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            async with conn.execute(
                f"SELECT {', '.join(EXPECTED)} FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            for name, default in EXPECTED.items():
                assert row[name] == default, name
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._105_add_retention_settings import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(app_settings)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert set(EXPECTED) <= columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 104)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 104
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
