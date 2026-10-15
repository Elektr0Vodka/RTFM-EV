"""Tests for migration 150: Remote CLI permission and incoming CLI command rows."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    rows = await (await conn.execute(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


class TestMigration150:
    @pytest.mark.asyncio
    async def test_adds_nullable_columns(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 149)
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 149
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            assert "remote_cli" in await _columns(conn, "contacts")
            assert "cli_permitted" in await _columns(conn, "messages")
            row = await (await conn.execute("SELECT remote_cli FROM contacts")).fetchone()
            assert row[0] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_idempotent_without_tables(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await set_version(conn, 149)
            await conn.commit()
            await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
