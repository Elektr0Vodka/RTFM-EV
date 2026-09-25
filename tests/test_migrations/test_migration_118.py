"""Tests for database migration 118: packet_receptions + its retention setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


class TestMigration118:
    @pytest.mark.asyncio
    async def test_creates_table_and_setting(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await set_version(conn, 117)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 117
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert "last_hop_hex" in await _columns(conn, "packet_receptions")
            assert "packet_reception_retention_days" in await _columns(conn, "app_settings")
            cursor = await conn.execute("SELECT packet_reception_retention_days FROM app_settings")
            assert (await cursor.fetchone())[0] == 2
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_settings_table(self):
        from app.migrations._118_create_packet_receptions import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no app_settings: table still created, no column added
            assert "payload_hash" in await _columns(conn, "packet_receptions")
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            assert "packet_reception_retention_days" in await _columns(conn, "app_settings")
        finally:
            await conn.close()
