"""Tests for migration 152: meshcomod companion receive filter tables."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_creates_tables_and_index():
    conn = await aiosqlite.connect(":memory:")
    try:
        await set_version(conn, 151)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 151
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        rows = await (await conn.execute("PRAGMA table_info(companion_filter_history)")).fetchall()
        assert {
            "timestamp",
            "malformed",
            "age",
            "path",
            "sender",
            "text",
            "radio_identity_id",
        } <= {r[1] for r in rows}
        idx = await (await conn.execute("PRAGMA index_list(companion_filter_history)")).fetchall()
        assert any(r[1] == "idx_companion_filter_history_timestamp" for r in idx)

        rows = await (await conn.execute("PRAGMA table_info(companion_filter_backups)")).fetchall()
        assert {"radio_identity_id", "config", "truncated", "saved_at"} <= {r[1] for r in rows}
    finally:
        await conn.close()
