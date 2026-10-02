"""Tests for migration 127: delete bot fanout configs."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_CREATE_FANOUT = """
    CREATE TABLE fanout_configs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        scope TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT 0
    )
"""


class TestMigration127:
    @pytest.mark.asyncio
    async def test_deletes_only_bot_rows(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute(_CREATE_FANOUT)
            await conn.executemany(
                "INSERT INTO fanout_configs (id, type, name) VALUES (?, ?, ?)",
                [
                    ("b1", "bot", "Bot 1"),
                    ("b2", "bot", "Bot 2"),
                    ("w1", "webhook", "Hook"),
                    ("m1", "mqtt_private", "MQTT"),
                ],
            )
            await conn.commit()
            await set_version(conn, 126)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 126
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT id FROM fanout_configs ORDER BY id") as cur:
                ids = [row["id"] for row in await cur.fetchall()]
            assert ids == ["m1", "w1"]
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_table(self):
        from app.migrations._127_delete_bot_fanout_configs import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)  # no fanout_configs table: no-op

            await conn.execute(_CREATE_FANOUT)
            await conn.execute(
                "INSERT INTO fanout_configs (id, type, name) VALUES ('w1', 'webhook', 'Hook')"
            )
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            async with conn.execute("SELECT COUNT(*) FROM fanout_configs") as cur:
                assert (await cur.fetchone())[0] == 1
        finally:
            await conn.close()
