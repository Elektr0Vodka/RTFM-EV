"""Tests for migration 163: wardrive drives, derived for stored rows by the
10-minute gap rule."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from app.migrations._161_create_wardrive_tables import migrate as migrate_161
from app.migrations._162_create_wardrive_config import migrate as migrate_162
from app.migrations._163_create_wardrive_drives import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION

BASE = 1792404000  # 2026-10-19T10:00:00Z


def _iso(ts: int) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def _seed(conn: aiosqlite.Connection) -> None:
    await migrate_161(conn)
    await migrate_162(conn)
    for uid, name in ((1, "anna"), (2, "bert")):
        await conn.execute(
            "INSERT INTO wardrive_users (id, username, password_hash, created_at) "
            "VALUES (?, ?, 'x', 0)",
            (uid, name),
        )

    async def obs(user: int, radio: str, dt: int) -> None:
        ts = BASE + dt
        await conn.execute(
            "INSERT INTO wardrive_obs (user_id, radio_key, rx_at, rx_ts, hash, raw, lat, lon, "
            "uploaded_at) VALUES (?, ?, ?, ?, ?, 'aa', 52.1, 5.1, 0)",
            (user, radio, _iso(ts), ts, f"{dt:016x}"),
        )

    async def track(user: int, radio: str, dt: int) -> None:
        ts = BASE + dt
        await conn.execute(
            "INSERT INTO wardrive_tracks (user_id, radio_key, t0, t1, t0_ts, lat, lon, rx_count, "
            "listening, uploaded_at) VALUES (?, ?, ?, ?, ?, 52.1, 5.1, 0, 1, 0)",
            (user, radio, _iso(ts), _iso(ts + 10), ts),
        )

    for dt in (0, 300, 1000):
        await obs(1, "R1", dt)
    for dt in (100, 1100):
        await track(1, "R1", dt)
    await obs(2, "R2", 50)
    await set_version(conn, 162)
    await conn.commit()


async def _drives(conn: aiosqlite.Connection) -> list[tuple]:
    cur = await conn.execute(
        "SELECT id, uid, user_id, radio_key, start_ts, end_ts FROM wardrive_drives ORDER BY id"
    )
    return [tuple(r) for r in await cur.fetchall()]


@pytest.mark.asyncio
async def test_derives_drives_from_gaps_per_user_and_radio():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _seed(conn)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 162
        assert await get_version(conn) == LATEST_SCHEMA_VERSION

        drives = await _drives(conn)
        by_user = sorted((d[2], d[4] - BASE, d[5] - BASE) for d in drives)
        # anna: 0..300 (track 100..110 inside), then 1000..1110 (track t1); bert: 50..50
        assert by_user == [(1, 0, 300), (1, 1000, 1110), (2, 50, 50)]
        assert all(d[1] is None for d in drives)

        for table in ("wardrive_obs", "wardrive_tracks"):
            cur = await conn.execute(f"SELECT COUNT(*) FROM {table} WHERE drive_id IS NULL")
            assert (await cur.fetchone())[0] == 0
        cur = await conn.execute("SELECT t0_ts, t1_ts FROM wardrive_tracks ORDER BY t0_ts")
        assert [tuple(r) for r in await cur.fetchall()] == [
            (BASE + 100, BASE + 110),
            (BASE + 1100, BASE + 1110),
        ]
        first = [d for d in drives if d[4] == BASE][0][0]
        cur = await conn.execute(
            "SELECT rx_ts - ? FROM wardrive_obs WHERE drive_id = ? ORDER BY rx_ts", (BASE, first)
        )
        assert [r[0] for r in await cur.fetchall()] == [0, 300]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_a_gap_of_exactly_ten_minutes_does_not_split():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate_161(conn)
        await conn.execute(
            "INSERT INTO wardrive_users (id, username, password_hash, created_at) "
            "VALUES (1, 'anna', 'x', 0)"
        )
        for dt in (0, 600, 1201):
            await conn.execute(
                "INSERT INTO wardrive_obs (user_id, radio_key, rx_at, rx_ts, hash, raw, lat, lon, "
                "uploaded_at) VALUES (1, 'R1', ?, ?, ?, 'aa', 52.1, 5.1, 0)",
                (_iso(BASE + dt), BASE + dt, f"{dt:016x}"),
            )
        await migrate(conn)
        assert [(d[4] - BASE, d[5] - BASE) for d in await _drives(conn)] == [(0, 600), (1201, 1201)]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await _seed(conn)
        await migrate(conn)
        before = await _drives(conn)
        await migrate(conn)
        assert await _drives(conn) == before
    finally:
        await conn.close()
