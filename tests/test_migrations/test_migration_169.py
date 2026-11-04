"""Tests for migration 169: malformed flag for a sender clock running ahead."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._169_add_malformed_clock_ahead import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

NOW = 1793800000


async def _setup(conn: aiosqlite.Connection) -> None:
    await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.execute(
        """
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY, type TEXT, outgoing INTEGER, txt_type INTEGER,
            text TEXT, sender_timestamp INTEGER, received_at INTEGER,
            malformed INTEGER NOT NULL DEFAULT 0, malformed_reason TEXT
        )
        """
    )
    rows = [
        # id, type, outgoing, txt_type, sender_timestamp, malformed, reason
        (1, "CHAN", 0, 0, NOW + 2 * 86400, 0, None),  # ahead -> clock
        (2, "CHAN", 0, 0, NOW + 2 * 86400, 1, "text"),  # ahead + text -> both
        (3, "CHAN", 0, 0, NOW + 30 * 60, 0, None),  # within the hour
        (4, "CHAN", 1, 0, NOW + 2 * 86400, 0, None),  # outgoing
        (5, "PRIV", 0, 0, NOW + 2 * 86400, 0, None),  # direct message
        (6, "CHAN", 0, 1, NOW + 2 * 86400, 0, None),  # not plain text
        (7, "CHAN", 0, 0, None, 0, None),  # no stamp
    ]
    await conn.executemany(
        "INSERT INTO messages (id, type, outgoing, txt_type, text, sender_timestamp, "
        "received_at, malformed, malformed_reason) VALUES (?, ?, ?, ?, 'x', ?, ?, ?, ?)",
        [(i, t, o, tt, ts, NOW, m, r) for i, t, o, tt, ts, m, r in rows],
    )


async def test_runs_from_168():
    async with aiosqlite.connect(":memory:") as conn:
        await set_version(conn, 168)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 168
        assert await get_version(conn) == LATEST_SCHEMA_VERSION


async def test_adds_setting_and_backfills():
    async with aiosqlite.connect(":memory:") as conn:
        await _setup(conn)
        await migrate(conn)
        cursor = await conn.execute("SELECT malformed_clock_ahead_minutes FROM app_settings")
        assert (await cursor.fetchone())[0] == 60
        cursor = await conn.execute("SELECT id, malformed, malformed_reason FROM messages")
        assert {row[0]: (row[1], row[2]) for row in await cursor.fetchall()} == {
            1: (1, "clock"),
            2: (1, "both"),
            3: (0, None),
            4: (0, None),
            5: (0, None),
            6: (0, None),
            7: (0, None),
        }


async def test_idempotent_and_backfills_once():
    async with aiosqlite.connect(":memory:") as conn:
        await _setup(conn)
        await migrate(conn)
        # A flag cleared later (operator turned the limit off) is not set again.
        await conn.execute(
            "UPDATE messages SET malformed = 0, malformed_reason = NULL WHERE id = 1"
        )
        await migrate(conn)
        cursor = await conn.execute("SELECT malformed FROM messages WHERE id = 1")
        assert (await cursor.fetchone())[0] == 0
