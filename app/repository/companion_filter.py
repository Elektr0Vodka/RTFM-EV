import json
from typing import Any

from app.database import db
from app.repository.radio_identities import StatScope

COUNTER_COLUMNS = ("malformed", "age", "path", "sender", "text")


class CompanionFilterHistoryRepository:
    """Cumulative meshcomod companion filter counters, one row per 60s sample."""

    @staticmethod
    async def insert(
        timestamp: int, counters: dict[str, int], radio_identity_id: int | None = None
    ) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO companion_filter_history "
                "(timestamp, malformed, age, path, sender, text, radio_identity_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    timestamp,
                    *(int(counters.get(col, 0)) for col in COUNTER_COLUMNS),
                    radio_identity_id,
                ),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int, scope: StatScope | None = None) -> list[dict]:
        """Samples in the window, oldest first, each with its ``radio_identity_id``."""
        where, params = (scope or StatScope()).where()
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, malformed, age, path, sender, text, radio_identity_id "
                "FROM companion_filter_history "
                f"WHERE timestamp >= ? AND timestamp <= ?{where} ORDER BY timestamp ASC",
                (start_ts, end_ts, *params),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": r["timestamp"],
                "radio_identity_id": r["radio_identity_id"],
                **{col: r[col] for col in COUNTER_COLUMNS},
            }
            for r in rows
        ]


class CompanionFilterBackupRepository:
    """Last filter settings read from each radio, for restoring after a reset."""

    @staticmethod
    async def get(radio_identity_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT config, truncated, saved_at FROM companion_filter_backups "
                "WHERE radio_identity_id = ?",
                (radio_identity_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "config": json.loads(row["config"]),
            "truncated": bool(row["truncated"]),
            "saved_at": row["saved_at"],
        }

    @staticmethod
    async def save(
        radio_identity_id: int, config: dict[str, Any], *, truncated: bool, saved_at: int
    ) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO companion_filter_backups "
                "(radio_identity_id, config, truncated, saved_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(radio_identity_id) DO UPDATE SET config = excluded.config, "
                "truncated = excluded.truncated, saved_at = excluded.saved_at",
                (radio_identity_id, json.dumps(config), 1 if truncated else 0, saved_at),
            ):
                pass
