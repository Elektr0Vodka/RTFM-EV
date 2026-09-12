"""Tests for database migration 080: create advert_events + retention setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration080:
    @pytest.mark.asyncio
    async def test_creates_table_column_and_backfills(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 79)
            # Minimal app_settings single row (migration adds the new column).
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            # Existing advert paths to backfill from: one direct, one flooded.
            await conn.execute(
                """
                CREATE TABLE contact_advert_paths (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    public_key TEXT NOT NULL,
                    path_hex TEXT NOT NULL,
                    path_len INTEGER NOT NULL,
                    first_seen INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    last_primary_seen INTEGER,
                    heard_count INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            await conn.execute(
                "INSERT INTO contact_advert_paths "
                "(public_key, path_hex, path_len, first_seen, last_seen, last_primary_seen, heard_count) "
                "VALUES ('aa', '', 0, 100, 500, 500, 3), "
                "       ('aa', 'bbbbccccdddd', 3, 100, 600, 600, 2)"
            )
            await conn.commit()

            applied = await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert applied == LATEST_SCHEMA_VERSION - 79

            # New column on app_settings, default 30.
            cur = await conn.execute("PRAGMA table_info(app_settings)")
            cols = {r[1]: r for r in await cur.fetchall()}
            assert "advert_retention_days" in cols

            cur = await conn.execute("SELECT advert_retention_days FROM app_settings WHERE id = 1")
            assert (await cur.fetchone())["advert_retention_days"] == 30

            # Backfilled events: one direct (min_path_len 0), one flood (3).
            cur = await conn.execute(
                "SELECT public_key, transmission_id, min_path_len, path_hex, hop_width, first_seen "
                "FROM advert_events ORDER BY min_path_len"
            )
            rows = await cur.fetchall()
            assert len(rows) == 2
            assert rows[0]["min_path_len"] == 0
            assert rows[0]["transmission_id"] is None  # backfill rows have no txid
            assert rows[0]["first_seen"] == 500
            assert rows[1]["min_path_len"] == 3
            assert rows[1]["hop_width"] == 2  # 12 hex / 3 hops / 2 = 2 bytes per hop
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_idempotent_without_source_tables(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 79)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await run_migrations(conn)  # must not raise with no contact_advert_paths
            cur = await conn.execute("SELECT COUNT(*) AS n FROM advert_events")
            assert (await cur.fetchone())["n"] == 0
        finally:
            await conn.close()
