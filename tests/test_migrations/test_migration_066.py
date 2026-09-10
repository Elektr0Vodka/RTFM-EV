"""Tests for database migration 066: add contact_advert_paths signal columns."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration066:
    """Test migration 066: add best_rssi/best_snr to contact_advert_paths."""

    @pytest.mark.asyncio
    async def test_adds_signal_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 65)
            await conn.execute(
                """
                CREATE TABLE contact_advert_paths (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    public_key TEXT NOT NULL,
                    path_hex TEXT NOT NULL,
                    path_len INTEGER NOT NULL,
                    first_seen INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    heard_count INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 65
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(contact_advert_paths)")
            cols = {row[1]: row[2] for row in await cursor.fetchall()}
            assert cols.get("best_rssi") == "REAL"
            assert cols.get("best_snr") == "REAL"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_table_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 65)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 65
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
