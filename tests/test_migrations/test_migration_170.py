"""Tests for migration 170: chat "Hide duplicates" setting."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._170_add_hide_duplicates import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration170:
    async def test_adds_column_default_off_and_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute("SELECT hide_duplicates FROM app_settings")
            assert (await cursor.fetchone())["hide_duplicates"] == 0
        finally:
            await conn.close()

    async def test_no_app_settings_table_is_a_noop(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
        finally:
            await conn.close()

    async def test_run_migrations_reaches_latest(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 169)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.commit()
            await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
