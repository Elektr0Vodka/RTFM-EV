"""Tests for migration 157: tracker_positions + tracker_objects."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._157_create_tracker_tables import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _names(conn: aiosqlite.Connection, kind: str) -> set[str]:
    rows = await (
        await conn.execute("SELECT name FROM sqlite_master WHERE type = ?", (kind,))
    ).fetchall()
    return {r[0] for r in rows}


@pytest.mark.asyncio
async def test_creates_tables_and_indexes():
    conn = await aiosqlite.connect(":memory:")
    try:
        await set_version(conn, 156)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 156
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        assert {"tracker_positions", "tracker_objects"} <= await _names(conn, "table")
        assert {
            "idx_tracker_positions_source_identity_time",
            "idx_tracker_positions_time",
            "idx_tracker_objects_time",
        } <= await _names(conn, "index")
        columns = await (await conn.execute("PRAGMA table_info(tracker_positions)")).fetchall()
        assert "cot_uid" in {c[1] for c in columns}
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        await migrate(conn)
        assert "tracker_positions" in await _names(conn, "table")
    finally:
        await conn.close()
