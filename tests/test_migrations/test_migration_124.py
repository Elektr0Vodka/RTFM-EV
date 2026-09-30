"""Tests for database migration 124: relay_reception_hourly + its retention setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


class TestMigration124:
    @pytest.mark.asyncio
    async def test_creates_table_and_setting(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await set_version(conn, 123)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 123
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            columns = await _columns(conn, "relay_reception_hourly")
            assert {"hour_ts", "relay_hex", "first_arrivals", "unique_packets"} <= columns
            cursor = await conn.execute("SELECT relay_history_retention_days FROM app_settings")
            assert (await cursor.fetchone())[0] == 365
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_settings_table(self):
        from app.migrations._124_create_relay_reception_hourly import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no app_settings: table still created, no column added
            assert "snr_sum" in await _columns(conn, "relay_reception_hourly")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            assert "relay_history_retention_days" in await _columns(conn, "app_settings")
        finally:
            await conn.close()
