"""Wardrive plugin storage: accounts, radios, groups, sessions, and the
local copy of what drivers' radios heard."""

import json
import sqlite3
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
        user_id: int, radio_key: str, rows: list[Obs], now: int
    ) -> tuple[int, int]:
        """Store receptions; a row already stored (same radio, rx_at, hash) is a
        duplicate. Returns (accepted, duplicates)."""
        key = normalize_key(radio_key)
        accepted = 0
        async with db.tx() as conn:
            for o in rows:
                async with conn.execute(
                    "INSERT OR IGNORE INTO wardrive_obs (user_id, radio_key, rx_at, rx_ts, pub_at, "
                    "hash, raw, len, packet_type, route, payload_len, path, rssi, snr, lat, lon, "
                    "accuracy, src, uploaded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    ),
                ) as cursor:
                    accepted += cursor.rowcount
        return accepted, len(rows) - accepted

    @staticmethod
    async def insert_tracks(
        user_id: int, radio_key: str, rows: list[Track], now: int
    ) -> tuple[int, int]:
        """Store listening intervals; same radio and t0 is a duplicate."""
        key = normalize_key(radio_key)
        accepted = 0
        async with db.tx() as conn:
            for t in rows:
                async with conn.execute(
                    "INSERT OR IGNORE INTO wardrive_tracks (user_id, radio_key, t0, t1, t0_ts, lat, "
                    "lon, accuracy, rx_count, listening, src, uploaded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        user_id,
                        key,
                        t.t0,
                        t.t1,
                        iso_to_ts(t.t0),
                        t.lat,
                        t.lon,
                        t.accuracy,
                        t.rx_count,
                        1 if t.listening else 0,
                        t.src,
                        now,
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
                "SELECT public_key, name, type, lat, lon, last_advert FROM contacts "
                "WHERE length(public_key) = 64 AND last_advert > 0"
            ) as cursor:
                return [dict(r) for r in await cursor.fetchall()]
