"""Tests for database migration 125: covering index for traffic-link windows."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

WINDOW_QUERY = """
    SELECT a_pubkey, b_pubkey, hop_width, COUNT(DISTINCT raw_packet_id), MIN(ts), MAX(ts),
           MAX(CASE WHEN confidence IN ('unique', 'confirmed') THEN 1 ELSE 0 END)
    FROM link_edge_events WHERE 1 = 1 AND ts >= ?
    GROUP BY a_pubkey, b_pubkey, hop_width
"""


async def _create_link_edge_events(conn: aiosqlite.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE link_edge_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, raw_packet_id INTEGER NOT NULL,
            ts INTEGER NOT NULL, a_pubkey TEXT NOT NULL, b_pubkey TEXT NOT NULL,
            hop_width INTEGER NOT NULL, payload_type TEXT, route_type TEXT,
            confidence TEXT NOT NULL, snr REAL, rssi INTEGER
        )
        """
    )


class TestMigration125:
    @pytest.mark.asyncio
    async def test_window_query_uses_covering_index(self):
        conn = await aiosqlite.connect(":memory:")
        try:
            await _create_link_edge_events(conn)
            await set_version(conn, 124)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 124
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            cursor = await conn.execute("EXPLAIN QUERY PLAN " + WINDOW_QUERY, (0,))
            plan = " ".join(row[3] for row in await cursor.fetchall())
            assert "COVERING INDEX ix_link_edge_events_group" in plan
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_table(self):
        from app.migrations._125_add_link_edge_group_index import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)  # no link_edge_events: nothing to do
            await _create_link_edge_events(conn)
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'ix_link_edge_events_group'"
            )
            assert (await cursor.fetchone())[0] == 1
        finally:
            await conn.close()
