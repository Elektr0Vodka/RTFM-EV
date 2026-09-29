"""Tests for database migration 123: radio_identities + per-radio stat columns."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


class TestMigration123:
    @pytest.mark.asyncio
    async def test_creates_registry_and_keeps_existing_samples_unassigned(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(
                "CREATE TABLE battery_history (timestamp INTEGER NOT NULL, "
                "battery_mv INTEGER NOT NULL)"
            )
            await conn.execute(
                "CREATE TABLE noise_floor_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "timestamp INTEGER NOT NULL, noise_floor_dbm INTEGER NOT NULL)"
            )
            await conn.execute(
                "CREATE TABLE airtime_history (timestamp INTEGER NOT NULL, "
                "tx_air_secs INTEGER NOT NULL, rx_air_secs INTEGER NOT NULL, "
                "recv_errors INTEGER)"
            )
            await conn.execute("INSERT INTO battery_history VALUES (100, 4000)")
            await conn.execute(
                "INSERT INTO noise_floor_samples (timestamp, noise_floor_dbm) VALUES (100, -110)"
            )
            await conn.execute("INSERT INTO airtime_history VALUES (100, 1, 2, NULL)")
            await conn.commit()
            await set_version(conn, 122)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 122
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert {
                "id",
                "public_key",
                "name",
                "notes",
                "first_connected",
                "last_connected",
                "status",
                "pending_reason",
                "replaced_by",
                "carry_stats",
                "carry_owned",
                "is_active",
            } <= await _columns(conn, "radio_identities")
            for table in ("battery_history", "noise_floor_samples", "airtime_history"):
                assert "radio_identity_id" in await _columns(conn, table)
                async with conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE radio_identity_id IS NULL"
                ) as cur:
                    row = await cur.fetchone()
                assert row[0] == 1  # the old sample survives, unassigned
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_missing_stat_tables(self):
        from app.migrations._123_create_radio_identities import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no stat tables: registry only
            await conn.execute(
                "CREATE TABLE battery_history (timestamp INTEGER NOT NULL, "
                "battery_mv INTEGER NOT NULL)"
            )
            await migrate(conn)
            await migrate(conn)
            assert "radio_identity_id" in await _columns(conn, "battery_history")
            assert "public_key" in await _columns(conn, "radio_identities")
        finally:
            await conn.close()
