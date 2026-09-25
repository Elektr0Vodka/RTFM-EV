"""Repository for ``device_config_history`` (plan 14): repeater pane snapshots.

Append-on-change: a snapshot is stored only when it differs from the latest
stored one for the same contact and kind, so reopening a dashboard pane whose
values did not change adds nothing. Each ``(public_key, kind)`` keeps at most
``max_rows`` snapshots (newest kept).
"""

from __future__ import annotations

import json
from typing import Literal, get_args

from app.database import db

DeviceConfigKind = Literal[
    "node_info", "radio_settings", "advert_intervals", "owner_info", "regions"
]
KINDS: tuple[str, ...] = get_args(DeviceConfigKind)
DEFAULT_MAX_ROWS = 200


def _canonical(data: dict) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


class DeviceConfigHistoryRepository:
    @staticmethod
    async def record(
        public_key: str,
        kind: str,
        timestamp: int,
        data: dict,
        *,
        max_rows: int = DEFAULT_MAX_ROWS,
    ) -> bool:
        """Store a snapshot unless it equals the latest one. Returns True when stored."""
        if kind not in KINDS:
            raise ValueError(f"Unknown device config kind: {kind}")
        key = public_key.lower()
        blob = _canonical(data)
        async with db.tx() as conn:
            async with conn.execute(
                "SELECT data FROM device_config_history WHERE public_key = ? AND kind = ? "
                "ORDER BY timestamp DESC, id DESC LIMIT 1",
                (key, kind),
            ) as cursor:
                latest = await cursor.fetchone()
            if latest is not None and latest["data"] == blob:
                return False
            async with conn.execute(
                "INSERT INTO device_config_history (public_key, kind, timestamp, data) "
                "VALUES (?, ?, ?, ?)",
                (key, kind, timestamp, blob),
            ):
                pass
            if max_rows > 0:
                async with conn.execute(
                    """
                    DELETE FROM device_config_history WHERE id IN (
                        SELECT id FROM device_config_history
                        WHERE public_key = ? AND kind = ?
                        ORDER BY timestamp DESC, id DESC
                        LIMIT -1 OFFSET ?
                    )
                    """,
                    (key, kind, max_rows),
                ):
                    pass
        return True

    @staticmethod
    async def get_history(
        public_key: str, kind: str | None = None, *, limit: int = DEFAULT_MAX_ROWS
    ) -> list[dict]:
        """Snapshots for a contact, newest first, optionally one kind only."""
        params: list[object] = [public_key.lower()]
        where = "public_key = ?"
        if kind is not None:
            where += " AND kind = ?"
            params.append(kind)
        params.append(limit)
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT kind, timestamp, data FROM device_config_history WHERE {where} "
                "ORDER BY timestamp DESC, id DESC LIMIT ?",
                tuple(params),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {"kind": row["kind"], "timestamp": row["timestamp"], "data": json.loads(row["data"])}
            for row in rows
        ]
