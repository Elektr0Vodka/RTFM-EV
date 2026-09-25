import json
import time

from app.database import db


class HostRepeaterConfigRepository:
    """Single-row store for the host repeater settings document (migration _112)."""

    @staticmethod
    async def get() -> tuple[int, dict] | None:
        """Return ``(version, settings_dict)``, or None when never saved."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT version, settings FROM host_repeater_config WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        try:
            data = json.loads(row["settings"])
        except (TypeError, ValueError):
            data = {}
        return int(row["version"]), data if isinstance(data, dict) else {}

    @staticmethod
    async def save(expected_version: int, settings: dict) -> int | None:
        """Write the document if the stored version is still ``expected_version``.

        Version 0 means "never saved". Returns the new version, or None when the
        stored version changed in the meantime (the caller answers 409).
        """
        now = int(time.time())
        payload = json.dumps(settings, separators=(",", ":"))
        async with db.tx() as conn:
            async with conn.execute(
                "SELECT version FROM host_repeater_config WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
            current = int(row["version"]) if row is not None else 0
            if current != expected_version:
                return None
            new_version = current + 1
            async with conn.execute(
                "INSERT INTO host_repeater_config (id, version, settings, updated_at) "
                "VALUES (1, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET version = excluded.version, "
                "settings = excluded.settings, updated_at = excluded.updated_at",
                (new_version, payload, now),
            ):
                pass
        return new_version


class HostRepeaterContactsRepository:
    """Contact keys the host repeater needs (for-us MAC checks, DMC ACL bypass)."""

    @staticmethod
    async def full_keys() -> list[tuple[str, bool]]:
        """``(public_key, favorite)`` for every contact with a full 64-hex key."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT public_key, favorite FROM contacts WHERE length(public_key) = 64"
            ) as cursor:
                rows = await cursor.fetchall()
        return [(str(r["public_key"]).lower(), bool(r["favorite"])) for r in rows]


class HostRepeaterStatsRepository:
    """Single-row store for the lifetime host repeater counters (migration _114)."""

    @staticmethod
    async def get() -> dict | None:
        """``{since, runs, stats}`` or None when nothing was saved yet."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT since, runs, stats FROM host_repeater_stats WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        try:
            stats = json.loads(row["stats"])
        except (TypeError, ValueError):
            stats = {}
        return {
            "since": int(row["since"]),
            "runs": int(row["runs"]),
            "stats": stats if isinstance(stats, dict) else {},
        }

    @staticmethod
    async def save(since: int, runs: int, stats: dict) -> None:
        payload = json.dumps(stats, separators=(",", ":"))
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO host_repeater_stats (id, since, runs, stats, updated_at) "
                "VALUES (1, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET since = excluded.since, runs = excluded.runs, "
                "stats = excluded.stats, updated_at = excluded.updated_at",
                (since, runs, payload, int(time.time())),
            ):
                pass

    @staticmethod
    async def clear() -> None:
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM host_repeater_stats WHERE id = 1"):
                pass
