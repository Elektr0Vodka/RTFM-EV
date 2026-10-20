"""Wardrive plugin storage: accounts, radios, groups, sessions, and the
local copy of what drivers' radios heard."""

import json
import sqlite3
from collections.abc import Iterable
from typing import Any

from app.database import db
from app.wardrive.crypto import normalize_key
from app.wardrive.models import Obs, Track, iso_to_ts

VISIBILITY_VALUES = ("own", "groups", "all")


class UsernameTaken(Exception):
    pass


class RadioTaken(Exception):
    pass


def _user_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "password_hash": row["password_hash"],
        "visibility": row["visibility"],
        "disabled": bool(row["disabled"]),
        "created_at": row["created_at"],
    }


_USER_COLUMNS = "id, username, password_hash, visibility, disabled, created_at"


class WardriveUserRepository:
    @staticmethod
    async def create(username: str, password_hash: str, now: int) -> int:
        try:
            async with db.tx() as conn:
                async with conn.execute(
                    "INSERT INTO wardrive_users (username, password_hash, created_at) "
                    "VALUES (?, ?, ?)",
                    (username, password_hash, now),
                ) as cursor:
                    return int(cursor.lastrowid or 0)
        except sqlite3.IntegrityError:
            raise UsernameTaken(username) from None

    @staticmethod
    async def get(user_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_USER_COLUMNS} FROM wardrive_users WHERE id = ?", (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return _user_row(row) if row else None

    @staticmethod
    async def get_by_username(username: str) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_USER_COLUMNS} FROM wardrive_users WHERE username = ?", (username,)
            ) as cursor:
                row = await cursor.fetchone()
        return _user_row(row) if row else None

    @staticmethod
    async def list_all() -> list[dict[str, Any]]:
        """Every user with radios, group ids and stored reception count."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_USER_COLUMNS} FROM wardrive_users ORDER BY username"
            ) as cursor:
                users = [_user_row(r) for r in await cursor.fetchall()]
            async with conn.execute(
                "SELECT public_key, user_id, name, added_at FROM wardrive_radios "
                "ORDER BY added_at, rowid"
            ) as cursor:
                radios = await cursor.fetchall()
            async with conn.execute(
                "SELECT group_id, user_id FROM wardrive_group_members ORDER BY group_id"
            ) as cursor:
                members = await cursor.fetchall()
            async with conn.execute(
                "SELECT user_id, COUNT(*) AS n FROM wardrive_obs GROUP BY user_id"
            ) as cursor:
                counts = {r["user_id"]: r["n"] for r in await cursor.fetchall()}
        for user in users:
            uid = user["id"]
            user["radios"] = [
                {"public_key": r["public_key"], "name": r["name"], "added_at": r["added_at"]}
                for r in radios
                if r["user_id"] == uid
            ]
            user["group_ids"] = [m["group_id"] for m in members if m["user_id"] == uid]
            user["obs_count"] = counts.get(uid, 0)
        return users

    @staticmethod
    async def update(
        user_id: int, *, visibility: str | None = None, disabled: bool | None = None
    ) -> bool:
        sets: list[str] = []
        params: list[Any] = []
        if visibility is not None:
            if visibility not in VISIBILITY_VALUES:
                raise ValueError(f"Unknown visibility: {visibility}")
            sets.append("visibility = ?")
            params.append(visibility)
        if disabled is not None:
            sets.append("disabled = ?")
            params.append(1 if disabled else 0)
        if not sets:
            return await WardriveUserRepository.get(user_id) is not None
        async with db.tx() as conn:
            async with conn.execute(
                f"UPDATE wardrive_users SET {', '.join(sets)} WHERE id = ?",
                (*params, user_id),
            ) as cursor:
                return cursor.rowcount > 0

    @staticmethod
    async def delete(user_id: int) -> bool:
        """Delete a user with their radios, sessions, memberships and data."""
        async with db.tx() as conn:
            for table in (
                "wardrive_radios",
                "wardrive_sessions",
                "wardrive_group_members",
                "wardrive_obs",
                "wardrive_tracks",
                "wardrive_drives",
            ):
                await conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            async with conn.execute("DELETE FROM wardrive_users WHERE id = ?", (user_id,)) as cur:
                return cur.rowcount > 0


class WardriveRadioRepository:
    @staticmethod
    async def add(public_key: str, user_id: int, name: str | None, now: int) -> None:
        key = normalize_key(public_key)
        try:
            async with db.tx() as conn:
                await conn.execute(
                    "INSERT INTO wardrive_radios (public_key, user_id, name, added_at) "
                    "VALUES (?, ?, ?, ?)",
                    (key, user_id, name, now),
                )
        except sqlite3.IntegrityError:
            raise RadioTaken(key) from None

    @staticmethod
    async def list_for_user(user_id: int) -> list[dict[str, Any]]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT public_key, name, added_at FROM wardrive_radios WHERE user_id = ? "
                "ORDER BY added_at, rowid",
                (user_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {"public_key": r["public_key"], "name": r["name"], "added_at": r["added_at"]}
            for r in rows
        ]

    @staticmethod
    async def owner_of(public_key: str) -> int | None:
        key = normalize_key(public_key)
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT user_id FROM wardrive_radios WHERE public_key = ?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
        return row["user_id"] if row else None

    @staticmethod
    async def delete(public_key: str) -> bool:
        """Remove a radio from its account. Its stored data stays with the account."""
        key = normalize_key(public_key)
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM wardrive_radios WHERE public_key = ?", (key,)
            ) as cursor:
                return cursor.rowcount > 0


class WardriveGroupRepository:
    @staticmethod
    async def create(name: str, now: int) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO wardrive_groups (name, created_at) VALUES (?, ?)", (name, now)
            ) as cursor:
                return int(cursor.lastrowid or 0)

    @staticmethod
    async def rename(group_id: int, name: str) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE wardrive_groups SET name = ? WHERE id = ?", (name, group_id)
            ) as cursor:
                return cursor.rowcount > 0

    @staticmethod
    async def delete(group_id: int) -> bool:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_group_members WHERE group_id = ?", (group_id,))
            async with conn.execute(
                "DELETE FROM wardrive_groups WHERE id = ?", (group_id,)
            ) as cursor:
                return cursor.rowcount > 0

    @staticmethod
    async def list_all() -> list[dict[str, Any]]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, name, created_at FROM wardrive_groups ORDER BY name"
            ) as cursor:
                groups = await cursor.fetchall()
            async with conn.execute(
                "SELECT group_id, user_id FROM wardrive_group_members ORDER BY user_id"
            ) as cursor:
                members = await cursor.fetchall()
        return [
            {
                "id": g["id"],
                "name": g["name"],
                "created_at": g["created_at"],
                "member_ids": [m["user_id"] for m in members if m["group_id"] == g["id"]],
            }
            for g in groups
        ]

    @staticmethod
    async def set_members(group_id: int, user_ids: list[int]) -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_group_members WHERE group_id = ?", (group_id,))
            await conn.executemany(
                "INSERT OR IGNORE INTO wardrive_group_members (group_id, user_id) VALUES (?, ?)",
                [(group_id, uid) for uid in user_ids],
            )


class WardriveSessionRepository:
    @staticmethod
    async def create(token_hash: str, user_id: int, now: int, ttl_s: int) -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_sessions WHERE expires_at <= ?", (now,))
            await conn.execute(
                "INSERT INTO wardrive_sessions (token_hash, user_id, created_at, expires_at) "
                "VALUES (?, ?, ?, ?)",
                (token_hash, user_id, now, now + ttl_s),
            )

    @staticmethod
    async def get_user_id(token_hash: str, now: int) -> int | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT user_id FROM wardrive_sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, now),
            ) as cursor:
                row = await cursor.fetchone()
        return row["user_id"] if row else None

    @staticmethod
    async def delete(token_hash: str) -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_sessions WHERE token_hash = ?", (token_hash,))

    @staticmethod
    async def delete_for_user(user_id: int) -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_sessions WHERE user_id = ?", (user_id,))


class WardriveDataRepository:
    """The local copy of drivers' receptions and listening intervals."""

    @staticmethod
    async def insert_obs(
        user_id: int, radio_key: str, rows: list[Obs], now: int, drive_id: int | None = None
    ) -> tuple[int, int]:
        """Store receptions in ``drive_id``; a row already stored (same radio,
        rx_at, hash) is a duplicate. Returns (accepted, duplicates)."""
        key = normalize_key(radio_key)
        accepted = 0
        async with db.tx() as conn:
            for o in rows:
                async with conn.execute(
                    "INSERT OR IGNORE INTO wardrive_obs (user_id, radio_key, rx_at, rx_ts, pub_at, "
                    "hash, raw, len, packet_type, route, payload_len, path, rssi, snr, lat, lon, "
                    "accuracy, src, uploaded_at, drive_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        user_id,
                        key,
                        o.rx_at,
                        iso_to_ts(o.rx_at),
                        o.pub_at,
                        o.hash,
                        o.raw,
                        o.len,
                        o.packet_type,
                        o.route,
                        o.payload_len,
                        json.dumps(o.path),
                        o.RSSI,
                        o.SNR,
                        o.pos.lat,
                        o.pos.lon,
                        o.pos.accuracy,
                        o.pos.src,
                        now,
                        drive_id,
                    ),
                ) as cursor:
                    accepted += cursor.rowcount
        return accepted, len(rows) - accepted

    @staticmethod
    async def insert_tracks(
        user_id: int, radio_key: str, rows: list[Track], now: int, drive_id: int | None = None
    ) -> tuple[int, int]:
        """Store listening intervals in ``drive_id``; same radio and t0 is a duplicate."""
        key = normalize_key(radio_key)
        accepted = 0
        async with db.tx() as conn:
            for t in rows:
                async with conn.execute(
                    "INSERT OR IGNORE INTO wardrive_tracks (user_id, radio_key, t0, t1, t0_ts, "
                    "t1_ts, lat, lon, accuracy, rx_count, listening, src, uploaded_at, drive_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        user_id,
                        key,
                        t.t0,
                        t.t1,
                        iso_to_ts(t.t0),
                        iso_to_ts(t.t1),
                        t.lat,
                        t.lon,
                        t.accuracy,
                        t.rx_count,
                        1 if t.listening else 0,
                        t.src,
                        now,
                        drive_id,
                    ),
                ) as cursor:
                    accepted += cursor.rowcount
        return accepted, len(rows) - accepted

    @staticmethod
    async def query(
        user_ids: set[int] | None,
        since_ts: int,
        until_ts: int,
        radio_key: str | None = None,
        limit: int = 20000,
    ) -> dict[str, Any]:
        """Receptions and tracks in the window, newest first, for ``user_ids``
        (``None`` = everyone). ``truncated`` says a list hit ``limit``."""
        where = ["{ts} >= ?", "{ts} <= ?"]
        params: list[Any] = [since_ts, until_ts]
        if user_ids is not None:
            ids = sorted(user_ids)
            where.append(f"d.user_id IN ({', '.join('?' * len(ids))})")
            params.extend(ids)
        if radio_key is not None:
            where.append("d.radio_key = ?")
            params.append(normalize_key(radio_key))
        clause = " AND ".join(where)
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT d.user_id, u.username, d.radio_key, d.rx_at, d.hash, d.packet_type, "
                "d.route, d.path, d.rssi, d.snr, d.lat, d.lon, d.accuracy "
                "FROM wardrive_obs d JOIN wardrive_users u ON u.id = d.user_id "
                f"WHERE {clause.format(ts='d.rx_ts')} ORDER BY d.rx_ts DESC, d.id DESC LIMIT ?",
                (*params, limit + 1),
            ) as cursor:
                obs_rows = list(await cursor.fetchall())
            async with conn.execute(
                "SELECT d.user_id, u.username, d.radio_key, d.t0, d.t1, d.lat, d.lon, "
                "d.accuracy, d.rx_count, d.listening "
                "FROM wardrive_tracks d JOIN wardrive_users u ON u.id = d.user_id "
                f"WHERE {clause.format(ts='d.t0_ts')} ORDER BY d.t0_ts DESC, d.id DESC LIMIT ?",
                (*params, limit + 1),
            ) as cursor:
                track_rows = list(await cursor.fetchall())
        obs = [
            {**dict(r), "path": json.loads(r["path"]) if r["path"] else []}
            for r in obs_rows[:limit]
        ]
        tracks = [{**dict(r), "listening": bool(r["listening"])} for r in track_rows[:limit]]
        return {
            "obs": obs,
            "tracks": tracks,
            "truncated": len(obs_rows) > limit or len(track_rows) > limit,
        }


class WardriveConfigRepository:
    """Owner settings for the wardrive page, one JSON value per key."""

    @staticmethod
    async def get_json(key: str) -> Any | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT value FROM wardrive_config WHERE key = ?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
        return json.loads(row["value"]) if row else None

    @staticmethod
    async def set_json(key: str, value: Any, now: int) -> None:
        async with db.tx() as conn:
            await conn.execute(
                "INSERT INTO wardrive_config (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, "
                "updated_at = excluded.updated_at",
                (key, json.dumps(value), now),
            )

    @staticmethod
    async def delete(key: str) -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wardrive_config WHERE key = ?", (key,))


class WardriveNodeRepository:
    @staticmethod
    async def full_key_contacts() -> list[dict[str, Any]]:
        """Public advert data of every contact with a full key that was heard
        advertising: key, advertised name, type, advertised position and last
        advert. Nothing else; a contact added by hand (no advert) is left out,
        its name is the owner's own label."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT public_key, name, type, lat, lon, last_advert, last_seen FROM contacts "
                "WHERE length(public_key) = 64 AND last_advert > 0"
            ) as cursor:
                return [dict(r) for r in await cursor.fetchall()]


_DRIVE_COLUMNS = "id, uid, user_id, radio_key, name, notes, start_ts, end_ts, created_at"
# A row without a drive uid joins a drive whose span, widened by this on both
# sides, holds it (rx's ride gap).
DRIVE_GAP_S = 600


class WardriveDriveRepository:
    """Stored drives: one session of one radio (see app/wardrive/drives.py)."""

    @staticmethod
    async def get(drive_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_DRIVE_COLUMNS} FROM wardrive_drives WHERE id = ?", (drive_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    async def get_by_uid(uid: str) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_DRIVE_COLUMNS} FROM wardrive_drives WHERE uid = ?", (uid,)
            ) as cursor:
                row = await cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    async def create(
        user_id: int, radio_key: str, uid: str | None, start_ts: int, end_ts: int, now: int
    ) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO wardrive_drives (uid, user_id, radio_key, start_ts, end_ts, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (uid, user_id, normalize_key(radio_key), start_ts, end_ts, now),
            ) as cursor:
                return int(cursor.lastrowid or 0)

    @staticmethod
    async def drive_for_gap_row(user_id: int, radio_key: str, ts: int) -> int | None:
        """The user's drive of this radio whose span, widened by the ride gap
        on both sides, holds ``ts``; the nearest one when several do."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id FROM wardrive_drives WHERE user_id = ? AND radio_key = ? "
                "AND start_ts - ? <= ? AND end_ts + ? >= ? "
                "ORDER BY MIN(ABS(start_ts - ?), ABS(end_ts - ?)), id LIMIT 1",
                (user_id, normalize_key(radio_key), DRIVE_GAP_S, ts, DRIVE_GAP_S, ts, ts, ts),
            ) as cursor:
                row = await cursor.fetchone()
        return row["id"] if row else None

    @staticmethod
    async def extend(drive_id: int, start_ts: int, end_ts: int) -> None:
        """Widen a drive's span to hold ``start_ts..end_ts``."""
        async with db.tx() as conn:
            await conn.execute(
                "UPDATE wardrive_drives SET start_ts = MIN(start_ts, ?), "
                "end_ts = MAX(end_ts, ?) WHERE id = ?",
                (start_ts, end_ts, drive_id),
            )

    @staticmethod
    async def refresh_span(drive_ids: Iterable[int]) -> None:
        """Set each drive's span from its rows; a drive left without rows goes."""
        ids = sorted(set(drive_ids))
        if not ids:
            return
        async with db.tx() as conn:
            for drive_id in ids:
                async with conn.execute(
                    "SELECT MIN(s), MAX(e) FROM ("
                    "SELECT rx_ts AS s, rx_ts AS e FROM wardrive_obs WHERE drive_id = ? "
                    "UNION ALL SELECT t0_ts, COALESCE(t1_ts, t0_ts) FROM wardrive_tracks "
                    "WHERE drive_id = ?)",
                    (drive_id, drive_id),
                ) as cursor:
                    row = await cursor.fetchone()
                if row is None or row[0] is None:
                    await conn.execute("DELETE FROM wardrive_drives WHERE id = ?", (drive_id,))
                else:
                    await conn.execute(
                        "UPDATE wardrive_drives SET start_ts = ?, end_ts = ? WHERE id = ?",
                        (row[0], row[1], drive_id),
                    )

    @staticmethod
    async def list_drives(
        user_ids: set[int] | None,
        since_ts: int | None,
        until_ts: int | None,
        radio_key: str | None,
        limit: int,
        drive_ids: Iterable[int] | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """Drives overlapping the window, newest first, with owner, radio name
        and row counts. ``user_ids`` None = everyone. Returns (drives, truncated)."""
        where: list[str] = []
        params: list[Any] = []
        if drive_ids is not None:
            wanted = sorted(set(drive_ids))
            if not wanted:
                return [], False
            where.append(f"d.id IN ({', '.join('?' * len(wanted))})")
            params.extend(wanted)
        if user_ids is not None:
            ids = sorted(user_ids)
            if not ids:
                return [], False
            where.append(f"d.user_id IN ({', '.join('?' * len(ids))})")
            params.extend(ids)
        if since_ts is not None:
            where.append("d.end_ts >= ?")
            params.append(since_ts)
        if until_ts is not None:
            where.append("d.start_ts <= ?")
            params.append(until_ts)
        if radio_key is not None:
            where.append("d.radio_key = ?")
            params.append(normalize_key(radio_key))
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT d.id, d.uid, d.user_id, u.username, d.radio_key, r.name AS radio_name, "
                "d.name, d.notes, d.start_ts, d.end_ts, "
                "(SELECT COUNT(*) FROM wardrive_obs o WHERE o.drive_id = d.id) AS obs, "
                "(SELECT COUNT(*) FROM wardrive_tracks t WHERE t.drive_id = d.id) AS tracks "
                "FROM wardrive_drives d JOIN wardrive_users u ON u.id = d.user_id "
                "LEFT JOIN wardrive_radios r ON r.public_key = d.radio_key "
                f"{clause} ORDER BY d.start_ts DESC, d.id DESC LIMIT ?",
                (*params, limit + 1),
            ) as cursor:
                rows = [dict(r) for r in await cursor.fetchall()]
        return rows[:limit], len(rows) > limit

    @staticmethod
    async def update(drive_id: int, fields: dict[str, str | None]) -> None:
        """Set ``name`` and/or ``notes`` (the keys present in ``fields``)."""
        sets = [f"{k} = ?" for k in fields if k in ("name", "notes")]
        if not sets:
            return
        async with db.tx() as conn:
            await conn.execute(
                f"UPDATE wardrive_drives SET {', '.join(sets)} WHERE id = ?",
                (*[fields[k] for k in fields if k in ("name", "notes")], drive_id),
            )

    @staticmethod
    async def delete_with_rows(drive_id: int) -> tuple[int, int]:
        """Delete a drive and its stored rows. Returns (obs, tracks) deleted."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM wardrive_obs WHERE drive_id = ?", (drive_id,)
            ) as cursor:
                obs = cursor.rowcount
            async with conn.execute(
                "DELETE FROM wardrive_tracks WHERE drive_id = ?", (drive_id,)
            ) as cursor:
                tracks = cursor.rowcount
            await conn.execute("DELETE FROM wardrive_drives WHERE id = ?", (drive_id,))
        return obs, tracks

    @staticmethod
    async def merge(into_id: int, other_ids: list[int], notes: str | None) -> None:
        """Move the rows of ``other_ids`` into ``into_id``, set its notes and
        delete the others, in one transaction."""
        marks = ", ".join("?" * len(other_ids))
        async with db.tx() as conn:
            for table in ("wardrive_obs", "wardrive_tracks"):
                await conn.execute(
                    f"UPDATE {table} SET drive_id = ? WHERE drive_id IN ({marks})",
                    (into_id, *other_ids),
                )
            await conn.execute(f"DELETE FROM wardrive_drives WHERE id IN ({marks})", other_ids)
            await conn.execute(
                "UPDATE wardrive_drives SET notes = ? WHERE id = ?", (notes, into_id)
            )
        await WardriveDriveRepository.refresh_span([into_id])

    @staticmethod
    async def split(drive_id: int, at_ts: int, now: int) -> int | None:
        """Move rows at or after ``at_ts`` into a new drive of the same user
        and radio. None (nothing changed) when either side would be empty."""
        drive = await WardriveDriveRepository.get(drive_id)
        if drive is None:
            return None
        async with db.tx() as conn:
            async with conn.execute(
                "SELECT "
                "(SELECT COUNT(*) FROM wardrive_obs WHERE drive_id = ? AND rx_ts < ?) + "
                "(SELECT COUNT(*) FROM wardrive_tracks WHERE drive_id = ? AND t0_ts < ?), "
                "(SELECT COUNT(*) FROM wardrive_obs WHERE drive_id = ? AND rx_ts >= ?) + "
                "(SELECT COUNT(*) FROM wardrive_tracks WHERE drive_id = ? AND t0_ts >= ?)",
                (drive_id, at_ts) * 4,
            ) as cursor:
                row = await cursor.fetchone()
            if row is None or row[0] == 0 or row[1] == 0:
                return None
            async with conn.execute(
                "INSERT INTO wardrive_drives (uid, user_id, radio_key, start_ts, end_ts, "
                "created_at) VALUES (NULL, ?, ?, ?, ?, ?)",
                (drive["user_id"], drive["radio_key"], at_ts, drive["end_ts"], now),
            ) as cursor:
                new_id = int(cursor.lastrowid or 0)
            await conn.execute(
                "UPDATE wardrive_obs SET drive_id = ? WHERE drive_id = ? AND rx_ts >= ?",
                (new_id, drive_id, at_ts),
            )
            await conn.execute(
                "UPDATE wardrive_tracks SET drive_id = ? WHERE drive_id = ? AND t0_ts >= ?",
                (new_id, drive_id, at_ts),
            )
        await WardriveDriveRepository.refresh_span([drive_id, new_id])
        return new_id

    @staticmethod
    async def rows_for_report(
        drive_ids: list[int] | None,
        user_ids: set[int] | None,
        since_ts: int | None,
        until_ts: int | None,
        radio_key: str | None,
        limit: int,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
        """Receptions and track rows for a report or an export: the picked
        drives, or the window narrowed to users and a radio. The newest
        ``limit`` of each kind; True when a kind had more."""
        where: list[str] = []
        params: list[Any] = []
        if drive_ids is not None:
            if not drive_ids:
                return [], [], False
            where.append(f"d.drive_id IN ({', '.join('?' * len(drive_ids))})")
            params.extend(drive_ids)
        else:
            if user_ids is not None:
                ids = sorted(user_ids)
                if not ids:
                    return [], [], False
                where.append(f"d.user_id IN ({', '.join('?' * len(ids))})")
                params.extend(ids)
            if since_ts is not None:
                where.append("{ts} >= ?")
                params.append(since_ts)
            if until_ts is not None:
                where.append("{ts} <= ?")
                params.append(until_ts)
            if radio_key is not None:
                where.append("d.radio_key = ?")
                params.append(normalize_key(radio_key))
        clause = " AND ".join(where) or "1"
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT d.drive_id, d.user_id, u.username, d.radio_key, d.rx_ts, d.rssi, d.snr, "
                "d.lat, d.lon, d.accuracy, d.packet_type, d.route, d.path, "
                # The frame is needed only to check a zero-hop advert's signature.
                "CASE WHEN d.packet_type = 4 AND (d.path IS NULL OR d.path = '[]') "
                "THEN d.raw END AS raw, d.hash "
                "FROM wardrive_obs d JOIN wardrive_users u ON u.id = d.user_id "
                f"WHERE {clause.format(ts='d.rx_ts')} ORDER BY d.rx_ts DESC, d.id DESC LIMIT ?",
                (*params, limit + 1),
            ) as cursor:
                obs_rows = [dict(r) for r in await cursor.fetchall()]
            async with conn.execute(
                "SELECT d.drive_id, d.user_id, u.username, d.radio_key, d.t0_ts, "
                "COALESCE(d.t1_ts, d.t0_ts) AS t1_ts, d.lat, d.lon, d.accuracy, d.rx_count "
                "FROM wardrive_tracks d JOIN wardrive_users u ON u.id = d.user_id "
                f"WHERE {clause.format(ts='d.t0_ts')} ORDER BY d.t0_ts DESC, d.id DESC LIMIT ?",
                (*params, limit + 1),
            ) as cursor:
                track_rows = [dict(r) for r in await cursor.fetchall()]
        for row in obs_rows:
            row["path"] = json.loads(row["path"]) if row["path"] else []
        truncated = len(obs_rows) > limit or len(track_rows) > limit
        return obs_rows[:limit], track_rows[:limit], truncated

    @staticmethod
    async def delete_empty() -> int:
        """Delete drives without any stored row (after pruning or deletes)."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM wardrive_drives WHERE "
                "NOT EXISTS (SELECT 1 FROM wardrive_obs o WHERE o.drive_id = wardrive_drives.id) "
                "AND NOT EXISTS "
                "(SELECT 1 FROM wardrive_tracks t WHERE t.drive_id = wardrive_drives.id)"
            ) as cursor:
                return cursor.rowcount
