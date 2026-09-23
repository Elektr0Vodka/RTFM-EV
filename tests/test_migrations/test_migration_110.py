"""Tests for database migration 110: create the communities table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration110:
    @pytest.mark.asyncio
    async def test_creates_communities_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 109)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 109
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            cursor = await conn.execute("PRAGMA table_info(communities)")
            columns = {row["name"]: row for row in await cursor.fetchall()}
            assert set(columns) == {"id", "name", "secret", "created_at"}
            assert columns["id"]["pk"] == 1
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_keeps_rows(self):
        from app.migrations._110_create_communities import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await conn.execute(
                "INSERT INTO communities (id, name, secret, created_at) VALUES (?, ?, ?, ?)",
                ("ab" * 32, "Acme", b"\x01" * 32, 1),
            )
            await conn.commit()
            await migrate(conn)

            cursor = await conn.execute("SELECT name, secret FROM communities")
            rows = await cursor.fetchall()
            assert rows == [("Acme", b"\x01" * 32)]
        finally:
            await conn.close()
