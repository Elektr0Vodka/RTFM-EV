"""Tests for migration 132: settings of RTFM-EV's own SNMP agent."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration132:
    @pytest.mark.asyncio
    async def test_creates_one_settings_row_that_is_off(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 131)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 131
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT * FROM snmp_agent") as cur:
                rows = await cur.fetchall()
            assert len(rows) == 1
            row = rows[0]
            assert (row["id"], row["enabled"], row["port"], row["community"]) == (
                1,
                0,
                161,
                "public",
            )
            # Only the single settings row can exist.
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute("INSERT INTO snmp_agent (id) VALUES (2)")
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_keeps_saved_settings(self):
        from app.migrations._132_create_snmp_agent import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await migrate(conn)
            await conn.execute("UPDATE snmp_agent SET enabled = 1, port = 1161, community = 'mon'")
            await conn.commit()
            await migrate(conn)

            async with conn.execute("SELECT enabled, port, community FROM snmp_agent") as cur:
                rows = await cur.fetchall()
            assert [tuple(row) for row in rows] == [(1, 1161, "mon")]
        finally:
            await conn.close()
