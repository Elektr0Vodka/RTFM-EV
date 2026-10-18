"""Tests for migration 153: contact_snmp.use_as_telemetry."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._153_add_snmp_use_as_telemetry import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

_CONTACT_SNMP = """
    CREATE TABLE contact_snmp (
        public_key TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 161,
        community TEXT NOT NULL DEFAULT 'public',
        poll_enabled INTEGER NOT NULL DEFAULT 0,
        poll_interval_minutes INTEGER NOT NULL DEFAULT 5,
        last_ok_at INTEGER,
        last_error TEXT,
        last_error_at INTEGER,
        updated_at INTEGER NOT NULL
    )
"""


async def _column(conn: aiosqlite.Connection, name: str):
    rows = await (await conn.execute("PRAGMA table_info(contact_snmp)")).fetchall()
    return [r for r in rows if r[1] == name]


@pytest.mark.asyncio
async def test_adds_column_with_default_off():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute(_CONTACT_SNMP)
        await conn.execute(
            "INSERT INTO contact_snmp (public_key, host, updated_at) VALUES ('aa', 'h', 1)"
        )
        await set_version(conn, 152)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 152
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        column = await _column(conn, "use_as_telemetry")
        assert len(column) == 1
        assert column[0][4] == "0"  # dflt_value
        row = await (await conn.execute("SELECT use_as_telemetry FROM contact_snmp")).fetchone()
        assert row[0] == 0
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_skips_missing_table():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        tables = await (
            await conn.execute("SELECT name FROM sqlite_master WHERE name = 'contact_snmp'")
        ).fetchall()
        assert tables == []
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await conn.execute(_CONTACT_SNMP)
        await migrate(conn)
        await migrate(conn)
        assert len(await _column(conn, "use_as_telemetry")) == 1
    finally:
        await conn.close()
