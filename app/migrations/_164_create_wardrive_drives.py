from datetime import UTC, datetime

import aiosqlite

# rx's ride gap, frozen here (app/wardrive/drives.py has the live rule): more
# than this many seconds between successive rows starts a new drive.
GAP_S = 600


def _split(times: list[int]) -> list[list[int]]:
    groups: list[list[int]] = []
    last: int | None = None
    for i, t in enumerate(times):
        if last is None or t - last > GAP_S:
            groups.append([])
        groups[-1].append(i)
        last = t
    return groups


def _ts(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp())


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Wardrive drives (``MESHCORE_WARDRIVE``): one stored session of one radio.

    ``wardrive_drives.uid`` is the page's own drive id (a UUID; null for a
    drive derived from rows); it is RTFM-EV's alone and never forwarded.
    ``wardrive_obs.drive_id`` and ``wardrive_tracks.drive_id`` point at it;
    ``wardrive_tracks.t1_ts`` is ``t1`` as unix seconds. Rows stored before
    this migration get drives by the 10-minute gap rule, per user and radio,
    over receptions and tracks together. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_drives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT UNIQUE,
            user_id INTEGER NOT NULL,
            radio_key TEXT NOT NULL,
            name TEXT,
            notes TEXT,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_drives_user_start "
        "ON wardrive_drives (user_id, start_ts)"
    )
    if "drive_id" not in await _columns(conn, "wardrive_obs"):
        await conn.execute("ALTER TABLE wardrive_obs ADD COLUMN drive_id INTEGER")
    track_columns = await _columns(conn, "wardrive_tracks")
    if "drive_id" not in track_columns:
        await conn.execute("ALTER TABLE wardrive_tracks ADD COLUMN drive_id INTEGER")
    if "t1_ts" not in track_columns:
        await conn.execute("ALTER TABLE wardrive_tracks ADD COLUMN t1_ts INTEGER")
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_obs_drive ON wardrive_obs (drive_id)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_tracks_drive ON wardrive_tracks (drive_id)"
    )

    cursor = await conn.execute("SELECT id, t1 FROM wardrive_tracks WHERE t1_ts IS NULL")
    await conn.executemany(
        "UPDATE wardrive_tracks SET t1_ts = ? WHERE id = ?",
        [(_ts(t1), row_id) for row_id, t1 in await cursor.fetchall()],
    )

    # Derive drives for rows that have none: per user and radio, one timeline
    # of receptions (rx_ts) and tracks (t0_ts, ending at t1_ts).
    cursor = await conn.execute(
        "SELECT 'o', id, user_id, radio_key, rx_ts, rx_ts FROM wardrive_obs "
        "WHERE drive_id IS NULL "
        "UNION ALL SELECT 't', id, user_id, radio_key, t0_ts, t1_ts FROM wardrive_tracks "
        "WHERE drive_id IS NULL"
    )
    timelines: dict[tuple[int, str], list[tuple[int, int, str, int]]] = {}
    for kind, row_id, user_id, radio_key, start, end in await cursor.fetchall():
        timelines.setdefault((user_id, radio_key), []).append((start, end, kind, row_id))
    for (user_id, radio_key), rows in timelines.items():
        rows.sort()
        for group in _split([r[0] for r in rows]):
            members = [rows[i] for i in group]
            start = members[0][0]
            end = max(max(r[0], r[1]) for r in members)
            insert = await conn.execute(
                "INSERT INTO wardrive_drives (uid, user_id, radio_key, start_ts, end_ts, "
                "created_at) VALUES (NULL, ?, ?, ?, ?, ?)",
                (user_id, radio_key, start, end, start),
            )
            drive_id = insert.lastrowid
            for kind, table in (("o", "wardrive_obs"), ("t", "wardrive_tracks")):
                await conn.executemany(
                    f"UPDATE {table} SET drive_id = ? WHERE id = ?",
                    [(drive_id, r[3]) for r in members if r[2] == kind],
                )
    await conn.commit()
