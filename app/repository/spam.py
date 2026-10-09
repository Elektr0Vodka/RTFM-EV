import json
import time
from typing import Any

from app.database import db


def _loads(raw: Any) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class SpamGuardConfigRepository:
    """Single-row store for the Spam Guard settings document (migration _137)."""

    @staticmethod
    async def get() -> tuple[int, dict[str, Any]] | None:
        """Return ``(version, settings_dict)``, or None when never saved."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT version, settings FROM spam_guard_config WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return int(row["version"]), _loads(row["settings"])

    @staticmethod
    async def save(expected_version: int, settings: dict[str, Any]) -> int | None:
        """Write the document if the stored version is still ``expected_version``.

        Version 0 means "never saved". Returns the new version, or None when the
        stored version changed in the meantime (the caller answers 409).
        """
        now = int(time.time())
        payload = json.dumps(settings, separators=(",", ":"))
        async with db.tx() as conn:
            async with conn.execute("SELECT version FROM spam_guard_config WHERE id = 1") as cursor:
                row = await cursor.fetchone()
            current = int(row["version"]) if row is not None else 0
            if current != expected_version:
                return None
            new_version = current + 1
            async with conn.execute(
                "INSERT INTO spam_guard_config (id, version, settings, updated_at) "
                "VALUES (1, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET version = excluded.version, "
                "settings = excluded.settings, updated_at = excluded.updated_at",
                (new_version, payload, now),
            ):
                pass
        return new_version


class SpamGuardStateRepository:
    """Single-row store for what the detector has learnt (migration _137)."""

    @staticmethod
    async def get() -> dict[str, Any] | None:
        """The stored detector state, or None when nothing was saved yet."""
        async with db.readonly() as conn:
            async with conn.execute("SELECT state FROM spam_guard_state WHERE id = 1") as cursor:
                row = await cursor.fetchone()
        return None if row is None else _loads(row["state"])

    @staticmethod
    async def save(state: dict[str, Any]) -> None:
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO spam_guard_state (id, state, updated_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET state = excluded.state, "
                "updated_at = excluded.updated_at",
                (payload, int(time.time())),
            ):
                pass
