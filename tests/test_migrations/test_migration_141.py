"""Tests for migration 141: the stored OpenHop policy verdict on raw packets."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration141:
    @pytest.mark.asyncio
    async def test_adds_the_columns_and_keeps_existing_rows(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 140)
            await conn.execute("CREATE TABLE raw_packets (id INTEGER PRIMARY KEY, data BLOB)")
            await conn.execute("INSERT INTO raw_packets (data) VALUES (x'0102')")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 140
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            row = await (
                await conn.execute("SELECT policy_action, policy_rule FROM raw_packets")
            ).fetchone()
            assert tuple(row) == (None, None)
            index = await (
                await conn.execute(
                    "SELECT sql FROM sqlite_master WHERE name = 'idx_raw_packets_policy'"
                )
            ).fetchone()
            assert index is not None and "policy_action IS NOT NULL" in index["sql"]
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_table(self):
        from app.migrations._141_raw_packet_policy_verdict import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE raw_packets (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
