"""Tests for database migration 091: create fanout_mqtt_stats table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration091:
    """Test migration 091: create the fanout_mqtt_stats table."""

    @pytest.mark.asyncio
    async def test_creates_fanout_mqtt_stats_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            # Start just below 091 so only this migration runs.
            await set_version(conn, LATEST_SCHEMA_VERSION - 1)

            applied = await run_migrations(conn)

            assert applied == 1
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(fanout_mqtt_stats)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert columns == {
                "config_id",
                "messages_published",
                "publish_failures",
                "reconnects",
                "updated_at",
            }
        finally:
            await conn.close()
