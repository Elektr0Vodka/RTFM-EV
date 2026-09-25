"""Tests for database migration 117: analyzer_resolved_names."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _table_exists(conn: aiosqlite.Connection, name: str) -> bool:
    cursor = await conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    )
    return await cursor.fetchone() is not None


class TestMigration117:
    @pytest.mark.asyncio
    async def test_creates_cache_table(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 116)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 116
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert await _table_exists(conn, "analyzer_resolved_names")
            await conn.execute(
                "INSERT INTO analyzer_resolved_names VALUES (?, ?, ?, ?)",
                ("ab" * 32, None, "Corn", 1),
            )
            cursor = await conn.execute("SELECT resolved_name FROM analyzer_resolved_names")
            assert (await cursor.fetchone())[0] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._117_create_analyzer_resolved_names import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute(
                "INSERT INTO analyzer_resolved_names VALUES (?, ?, ?, ?)",
                ("ab" * 32, "Kept", "Corn", 1),
            )
            await conn.commit()
            await migrate(conn)
            cursor = await conn.execute("SELECT COUNT(*) FROM analyzer_resolved_names")
            assert (await cursor.fetchone())[0] == 1
        finally:
            await conn.close()
