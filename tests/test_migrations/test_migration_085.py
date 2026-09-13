"""Tests for database migration 085."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration085:
    """Test migration 085: add contact annotation columns."""

    @pytest.mark.asyncio
    async def test_adds_annotation_columns(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 84)
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY, name TEXT)")
            await conn.execute("INSERT INTO contacts (public_key, name) VALUES ('aa', 'Node')")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 84
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(contacts)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert {"notes", "owner_info", "owner_key", "manual_lat", "manual_lon"} <= columns

            # New columns default to NULL for the pre-existing row.
            cursor = await conn.execute(
                "SELECT notes, owner_info, owner_key, manual_lat, manual_lon "
                "FROM contacts WHERE public_key = 'aa'"
            )
            row = await cursor.fetchone()
            assert row["notes"] is None
            assert row["owner_info"] is None
            assert row["owner_key"] is None
            assert row["manual_lat"] is None
            assert row["manual_lon"] is None
        finally:
            await conn.close()
