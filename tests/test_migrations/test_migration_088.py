"""Tests for database migration 088: create airtime_history table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration088:
    @pytest.mark.asyncio
    async def test_creates_airtime_history_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 87)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 87
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(airtime_history)")
            cols = {row[1] for row in await cursor.fetchall()}
            assert {"timestamp", "tx_air_secs", "rx_air_secs"} <= cols
        finally:
            await conn.close()
