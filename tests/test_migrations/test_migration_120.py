"""Tests for database migration 120: device history retention setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


class TestMigration120:
    @pytest.mark.asyncio
    async def test_adds_setting_defaulting_to_keep_forever(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await set_version(conn, 119)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 119
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            cursor = await conn.execute("SELECT device_history_retention_days FROM app_settings")
            assert (await cursor.fetchone())[0] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_settings_table(self):
        from app.migrations._120_add_device_history_retention import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no app_settings: nothing to do
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            assert "device_history_retention_days" in await _columns(conn, "app_settings")
        finally:
            await conn.close()
