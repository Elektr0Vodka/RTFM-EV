"""Tests for database migration 065: add raw_packets signal columns."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration065:
    """Test migration 065: add rssi/snr/payload_type to raw_packets."""

    @pytest.mark.asyncio
    async def test_adds_signal_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 64)
            await conn.execute(
                """
                CREATE TABLE raw_packets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    data BLOB NOT NULL,
                    message_id INTEGER,
                    payload_hash BLOB
                )
                """
            )
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 64
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(raw_packets)")
            cols = {row[1]: row[2] for row in await cursor.fetchall()}
            assert cols.get("rssi") == "INTEGER"
            assert cols.get("snr") == "REAL"
            assert cols.get("payload_type") == "TEXT"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_raw_packets_absent(self):
        """Migration must not error on a database without the raw_packets table."""
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 64)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 64
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
