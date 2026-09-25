"""Tests for database migration 116: airtime_history.recv_errors."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection) -> set[str]:
    cursor = await conn.execute("PRAGMA table_info(airtime_history)")
    return {row[1] for row in await cursor.fetchall()}


class TestMigration116:
    @pytest.mark.asyncio
    async def test_adds_nullable_recv_errors_column(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                "CREATE TABLE airtime_history (timestamp INTEGER NOT NULL, "
                "tx_air_secs INTEGER NOT NULL, rx_air_secs INTEGER NOT NULL)"
            )
            await conn.execute("INSERT INTO airtime_history VALUES (1, 2, 3)")
            await set_version(conn, 115)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 115
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert "recv_errors" in await _columns(conn)
            cursor = await conn.execute("SELECT recv_errors FROM airtime_history")
            assert (await cursor.fetchone())[0] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_table(self):
        from app.migrations._116_add_airtime_history_recv_errors import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no table yet: no-op
            await conn.execute(
                "CREATE TABLE airtime_history (timestamp INTEGER NOT NULL, "
                "tx_air_secs INTEGER NOT NULL, rx_air_secs INTEGER NOT NULL)"
            )
            await migrate(conn)
            await migrate(conn)
            assert "recv_errors" in await _columns(conn)
        finally:
            await conn.close()
