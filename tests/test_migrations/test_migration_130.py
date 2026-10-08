"""Tests for migration 130: per-contact SNMP polling settings."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration130:
    @pytest.mark.asyncio
    async def test_creates_contact_snmp(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.execute("INSERT INTO contacts (public_key) VALUES ('aa')")
            await conn.commit()
            await set_version(conn, 129)

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 129
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            await conn.execute(
                "INSERT INTO contact_snmp (public_key, host, updated_at) VALUES ('aa', '10.0.0.1', 1)"
            )
            async with conn.execute("SELECT * FROM contact_snmp") as cur:
                row = await cur.fetchone()
            # Defaults: standard port, firmware default community, not scheduled.
            assert (row["port"], row["community"], row["poll_enabled"]) == (161, "public", 0)
            assert row["last_ok_at"] is None
            assert row["last_error"] is None

            # The settings (and the community) go away with the contact.
            await conn.execute("DELETE FROM contacts WHERE public_key = 'aa'")
            async with conn.execute("SELECT COUNT(*) AS n FROM contact_snmp") as cur:
                assert (await cur.fetchone())["n"] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._130_create_contact_snmp import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute("CREATE TABLE contacts (public_key TEXT PRIMARY KEY)")
            await conn.commit()
            await migrate(conn)
            await migrate(conn)
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contact_snmp'"
            )
            assert (await cursor.fetchone())[0] == 1
        finally:
            await conn.close()
