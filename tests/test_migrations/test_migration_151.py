"""Tests for migration 151: sensor telemetry push subscriptions."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_creates_table_and_index():
    conn = await aiosqlite.connect(":memory:")
    try:
        await set_version(conn, 150)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 150
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        rows = await (await conn.execute("PRAGMA table_info(sensor_push_subscriptions)")).fetchall()
        cols = {r[1] for r in rows}
        assert {
            "public_key",
            "enabled",
            "push_tag",
            "thresholds",
            "granted_until",
            "scope_name",
            "last_push_at",
            "last_attempt_at",
            "last_error",
            "updated_at",
        } <= cols
        idx = await (await conn.execute("PRAGMA index_list(sensor_push_subscriptions)")).fetchall()
        assert any(r[1] == "idx_sensor_push_tag" for r in idx)
    finally:
        await conn.close()
