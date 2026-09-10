"""Tests for database migration 069: create noise_floor_samples table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration069:
    @pytest.mark.asyncio
    async def test_creates_noise_floor_samples_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 68)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 68
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(noise_floor_samples)")
            cols = {row[1] for row in await cursor.fetchall()}
            assert {"id", "timestamp", "noise_floor_dbm"} <= cols
        finally:
            await conn.close()
