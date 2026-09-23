"""Tests for migration 107: link_edge_events, backfill state, retention column."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _tables(conn) -> set[str]:
    cur = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    return {row[0] for row in await cur.fetchall()}


class TestMigration107:
    @pytest.mark.asyncio
    async def test_creates_table_state_and_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.execute("CREATE TABLE raw_packets (id INTEGER PRIMARY KEY, data BLOB)")
            await conn.executemany(
                "INSERT INTO raw_packets (id, data) VALUES (?, x'00')", [(1,), (2,), (7,)]
            )
            await conn.commit()
            await set_version(conn, 106)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 106
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert {"link_edge_events", "link_edge_backfill_state"} <= await _tables(conn)

            cur = await conn.execute("SELECT next_id, end_id FROM link_edge_backfill_state")
            row = await cur.fetchone()
            assert (row["next_id"], row["end_id"]) == (1, 7)

            cur = await conn.execute("SELECT link_edge_retention_days FROM app_settings")
            assert (await cur.fetchone())[0] == 365

            cur = await conn.execute("PRAGMA index_list(link_edge_events)")
            names = {r["name"] for r in await cur.fetchall()}
            assert {
                "ux_link_edge_events_pkt_edge",
                "ix_link_edge_events_ts",
                "ix_link_edge_events_edge_ts",
            } <= names
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_tables(self):
        from app.migrations._107_create_link_edge_events import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)
            await migrate(conn)
            cur = await conn.execute("SELECT next_id, end_id FROM link_edge_backfill_state")
            row = await cur.fetchone()
            assert (row["next_id"], row["end_id"]) == (1, 0)
        finally:
            await conn.close()
