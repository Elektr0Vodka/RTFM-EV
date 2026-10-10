"""Tests for migration 138: the telemetry schedule minute setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration138:
    @pytest.mark.asyncio
    async def test_adds_the_setting_as_automatic(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 137)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 137
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            row = await (
                await conn.execute("SELECT telemetry_schedule_minute FROM app_settings")
            ).fetchone()
            assert row[0] == -1
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._138_telemetry_schedule_minute import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
