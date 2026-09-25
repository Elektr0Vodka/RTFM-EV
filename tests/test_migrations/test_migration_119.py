"""Tests for database migration 119: contact_location_history + device_config_history."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _tables(conn: aiosqlite.Connection) -> set[str]:
    cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {row[0] for row in await cursor.fetchall()}


class TestMigration119:
    @pytest.mark.asyncio
    async def test_creates_both_tables(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await set_version(conn, 118)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 118
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert {"contact_location_history", "device_config_history"} <= await _tables(conn)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._119_create_device_history import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
            assert {"contact_location_history", "device_config_history"} <= await _tables(conn)
        finally:
            await conn.close()
