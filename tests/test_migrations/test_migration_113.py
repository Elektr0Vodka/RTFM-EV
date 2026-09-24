"""Tests for database migration 113: add the scheduled-backup columns."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration113:
    """Test migration 113: add backup_schedule_enabled/interval_hours/keep."""

    @pytest.mark.asyncio
    async def test_adds_backup_schedule_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, max_radio_contacts INTEGER)"
            )
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            # Start just below 113 so only this migration runs.
            await set_version(conn, 112)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 112
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            async with conn.execute(
                "SELECT backup_schedule_enabled, backup_schedule_interval_hours, "
                "backup_schedule_keep FROM app_settings WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
            assert row["backup_schedule_enabled"] == 0
            assert row["backup_schedule_interval_hours"] == 24
            assert row["backup_schedule_keep"] == 7
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_app_settings_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 112)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 112
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
