"""Tests for database migration 114: create the host_repeater_stats table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration114:
    @pytest.mark.asyncio
    async def test_creates_single_row_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 113)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 113
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            await conn.execute(
                "INSERT INTO host_repeater_stats (id, since, runs, stats, updated_at) "
                "VALUES (1, 1, 1, '{}', 1)"
            )
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(
                    "INSERT INTO host_repeater_stats (id, since, runs, stats, updated_at) "
                    "VALUES (2, 1, 1, '{}', 1)"
                )
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 113)
            await conn.commit()
            await run_migrations(conn)
            from app.migrations._114_create_host_repeater_stats import migrate

            await migrate(conn)
            async with conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'host_repeater_stats'"
            ) as cur:
                assert await cur.fetchone() is not None
        finally:
            await conn.close()
