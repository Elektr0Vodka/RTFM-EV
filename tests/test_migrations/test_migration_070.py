"""Tests for database migration 070: create battery_history table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration070:
    @pytest.mark.asyncio
    async def test_creates_battery_history_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 69)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 69
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(battery_history)")
            cols = {row[1] for row in await cursor.fetchall()}
            assert {"timestamp", "battery_mv"} <= cols
        finally:
            await conn.close()
