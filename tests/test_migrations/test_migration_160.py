"""Tests for migration 160: temporary radio settings, SF stamps, sightings, profiles, scan lists."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._160_temp_radio_settings import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

STAMP_COLUMNS = {"radio_freq", "radio_bw", "radio_sf", "radio_cr"}


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    return {c[1] for c in await (await conn.execute(f"PRAGMA table_info({table})")).fetchall()}


async def _tables(conn: aiosqlite.Connection) -> set[str]:
    rows = await (
        await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    ).fetchall()
    return {r[0] for r in rows}


async def _base_tables(conn: aiosqlite.Connection) -> None:
    await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
    await conn.execute("CREATE TABLE raw_packets (id INTEGER PRIMARY KEY, data BLOB)")
    await conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)")
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.commit()


@pytest.mark.asyncio
async def test_adds_columns_and_tables():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _base_tables(conn)
        await set_version(conn, 159)
        await conn.commit()

        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 159
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        settings_cols = await _columns(conn, "app_settings")
        assert {"temp_radio_state", "hidden_radio_sfs"} <= settings_cols
        assert await _columns(conn, "raw_packets") >= STAMP_COLUMNS
        assert await _columns(conn, "messages") >= STAMP_COLUMNS
        assert {
            "public_key",
            "freq",
            "bw",
            "sf",
            "cr",
            "first_seen",
            "last_seen",
        } <= await _columns(conn, "contact_radio_sightings")
        assert {
            "public_key",
            "freq",
            "bw",
            "sf",
            "cr",
            "region",
            "duration_secs",
            "auto_switch",
            "updated_at",
        } <= await _columns(conn, "contact_radio_profiles")
        assert {
            "id",
            "name",
            "entries",
            "rounds",
            "normal_between_secs",
            "hold_on_activity_secs",
            "opt_ins",
            "created_at",
            "updated_at",
        } <= await _columns(conn, "radio_scan_lists")

        row = await (
            await conn.execute("SELECT temp_radio_state, hidden_radio_sfs FROM app_settings")
        ).fetchone()
        assert row[0] is None
        assert row[1] == "[]"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_is_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _base_tables(conn)
        await migrate(conn)
        await conn.execute("UPDATE app_settings SET hidden_radio_sfs = '[8]'")
        await conn.commit()
        await migrate(conn)
        row = await (await conn.execute("SELECT hidden_radio_sfs FROM app_settings")).fetchone()
        assert row[0] == "[8]"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_skips_missing_tables():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        tables = await _tables(conn)
        assert "app_settings" not in tables
        assert "contact_radio_sightings" in tables
    finally:
        await conn.close()
