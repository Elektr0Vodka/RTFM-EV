"""Tests for database migration 099: create partial_node_resolutions table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration099:
    """Test migration 099: create the partial_node_resolutions table."""

    @pytest.mark.asyncio
    async def test_creates_partial_node_resolutions_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 98)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 98
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(partial_node_resolutions)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert columns == {
                "prefix_hex",
                "resolved_pubkey",
                "resolved_name",
                "source",
                "confidence",
                "candidate_count",
                "resolved_by",
                "created_at",
                "updated_at",
            }
        finally:
            await conn.close()
