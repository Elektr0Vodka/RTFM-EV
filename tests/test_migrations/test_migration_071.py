"""Tests for database migration 071: add contact_advert_paths.last_primary_seen."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration071:
    @pytest.mark.asyncio
    async def test_adds_column_and_backfills_from_last_seen(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 70)
            await conn.execute(
                """
                CREATE TABLE contact_advert_paths (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    public_key TEXT NOT NULL,
                    path_hex TEXT NOT NULL,
                    path_len INTEGER NOT NULL,
                    first_seen INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    heard_count INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            # A primary-heard path (heard_count > 0) and a relay-only path (0).
            await conn.execute(
                "INSERT INTO contact_advert_paths "
                "(public_key, path_hex, path_len, first_seen, last_seen, heard_count) "
                "VALUES ('aa', '', 0, 100, 500, 3), ('aa', 'bb', 1, 100, 600, 0)"
            )
            await conn.commit()

            applied = await run_migrations(conn)
            assert applied == LATEST_SCHEMA_VERSION - 70
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cur = await conn.execute("PRAGMA table_info(contact_advert_paths)")
            assert "last_primary_seen" in {r[1] for r in await cur.fetchall()}

            cur = await conn.execute(
                "SELECT path_len, last_primary_seen FROM contact_advert_paths ORDER BY path_len"
            )
            rows = {r["path_len"]: r["last_primary_seen"] for r in await cur.fetchall()}
            assert rows[0] == 500  # heard_count>0 backfilled to last_seen
            assert rows[1] is None  # relay-only stays NULL
        finally:
            await conn.close()
