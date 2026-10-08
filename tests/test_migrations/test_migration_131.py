"""Tests for migration 131: stored SNMP history and the per-contact poll interval."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration131:
    @pytest.mark.asyncio
    async def test_adds_history_table_and_interval_column(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            # A contact_snmp row written by migration 130, before the interval existed.
            await conn.execute(
                """
                CREATE TABLE contact_snmp (
                    public_key TEXT PRIMARY KEY,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL DEFAULT 161,
                    community TEXT NOT NULL DEFAULT 'public',
                    poll_enabled INTEGER NOT NULL DEFAULT 0,
                    last_ok_at INTEGER,
                    last_error TEXT,
                    last_error_at INTEGER,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            await conn.execute(
                "INSERT INTO contact_snmp (public_key, host, updated_at) VALUES ('aa', '10.0.0.1', 1)"
            )
            await conn.commit()
            await set_version(conn, 130)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 130
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            async with conn.execute("SELECT poll_interval_minutes FROM contact_snmp") as cur:
                # Existing rows get the default interval.
                assert (await cur.fetchone())["poll_interval_minutes"] == 5

            await conn.execute(
                "INSERT INTO snmp_history (public_key, timestamp, data) VALUES ('aa', 10, '{}')"
            )
            await conn.execute("DELETE FROM contacts WHERE public_key = 'aa'")
            async with conn.execute("SELECT COUNT(*) AS n FROM snmp_history") as cur:
                assert (await cur.fetchone())["n"] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_tolerates_missing_contact_snmp(self):
        from app.migrations._131_snmp_history_and_interval import migrate

        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)  # contact_snmp absent: only the history table is created

            await conn.execute("CREATE TABLE contact_snmp (public_key TEXT PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)

            cursor = await conn.execute("PRAGMA table_info(contact_snmp)")
            assert "poll_interval_minutes" in {row["name"] for row in await cursor.fetchall()}
            cursor = await conn.execute(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'snmp_history'"
            )
            assert (await cursor.fetchone())["n"] == 1
        finally:
            await conn.close()
