"""Tests for migration 139: advert sender timestamp and the clock-sync repeater list."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration139:
    @pytest.mark.asyncio
    async def test_adds_both_columns_and_keeps_existing_rows(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 138)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.execute(
                """
                CREATE TABLE advert_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    transmission_id INTEGER,
                    public_key TEXT NOT NULL,
                    first_seen INTEGER NOT NULL,
                    min_path_len INTEGER NOT NULL,
                    path_hex TEXT,
                    hop_width INTEGER
                )
                """
            )
            await conn.execute(
                "INSERT INTO advert_events (transmission_id, public_key, first_seen, min_path_len)"
                " VALUES (1, 'aa', 1000, 0)"
            )
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 138
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            settings = await (
                await conn.execute("SELECT clock_sync_repeaters FROM app_settings")
            ).fetchone()
            assert settings["clock_sync_repeaters"] == "[]"

            # An advert stored before the migration has no sender timestamp.
            event = await (
                await conn.execute("SELECT first_seen, sender_timestamp FROM advert_events")
            ).fetchone()
            assert tuple(event) == (1000, None)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_absent_tables(self):
        from app.migrations._139_advert_clock_and_clock_sync import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
