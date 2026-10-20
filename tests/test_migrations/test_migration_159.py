"""Tests for migration 159: perf_samples (Performance page history)."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._159_create_perf_samples import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection) -> set[str]:
    return {c[1] for c in await (await conn.execute("PRAGMA table_info(perf_samples)")).fetchall()}


@pytest.mark.asyncio
async def test_creates_perf_samples():
    conn = await aiosqlite.connect(":memory:")
    try:
        await set_version(conn, 158)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 158
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert {"ts", "cpu", "rss_mb", "lag_p95", "pkts", "stalls", "warnings"} <= await _columns(
            conn
        )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_is_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        await conn.execute("INSERT INTO perf_samples (ts, cpu) VALUES (60, 1.5)")
        await migrate(conn)
        row = await (await conn.execute("SELECT cpu FROM perf_samples WHERE ts = 60")).fetchone()
        assert row[0] == 1.5
    finally:
        await conn.close()
