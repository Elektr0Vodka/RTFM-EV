"""Tests for migration 142: bot lists and the Hide bots switch."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration142:
    @pytest.mark.asyncio
    async def test_creates_the_tables_and_the_setting(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 141)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 141
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            row = await (await conn.execute("SELECT hide_bots FROM app_settings")).fetchone()
            assert row["hide_bots"] == 0

            await conn.execute(
                "INSERT INTO bot_lists (name, source, created_at) VALUES ('Mine', 'local', 1)"
            )
            await conn.execute("INSERT INTO bot_list_entries (list_id, name) VALUES (1, 'PingBot')")
            await conn.execute("INSERT INTO bot_exceptions (name) VALUES ('Alice')")
            lst = await (await conn.execute("SELECT * FROM bot_lists")).fetchone()
            assert (lst["enabled"], lst["block_forward"], lst["description"]) == (0, 0, "")
            entry = await (await conn.execute("SELECT * FROM bot_list_entries")).fetchone()
            assert (entry["public_key"], entry["note"], entry["forward_reviewed"]) == (
                None,
                None,
                1,
            )
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_skips_an_absent_settings_table(self):
        from app.migrations._142_create_bot_lists import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
