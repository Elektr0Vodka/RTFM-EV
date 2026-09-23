import json
import logging

from app.database import db

logger = logging.getLogger(__name__)

# Age and per-node row caps are applied by app/services/retention_pruner.py
# (telemetry_retention_days / telemetry_max_rows_per_node).


class RepeaterTelemetryRepository:
    @staticmethod
    async def record(
        public_key: str,
        timestamp: int,
        data: dict,
    ) -> None:
        """Insert a telemetry history row."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO repeater_telemetry_history
                    (public_key, timestamp, data)
                VALUES (?, ?, ?)
                """,
                (public_key, timestamp, json.dumps(data)),
            ):
                pass

    @staticmethod
    async def get_history(public_key: str, since_timestamp: int) -> list[dict]:
        """Return telemetry rows for a repeater since a given timestamp, ordered ASC."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT timestamp, data
                FROM repeater_telemetry_history
                WHERE public_key = ? AND timestamp >= ?
                ORDER BY timestamp ASC
                """,
                (public_key, since_timestamp),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": row["timestamp"],
                "data": json.loads(row["data"]),
            }
            for row in rows
        ]

    @staticmethod
    async def get_latest(public_key: str) -> dict | None:
        """Return the most recent telemetry row for a repeater, or None."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT timestamp, data
                FROM repeater_telemetry_history
                WHERE public_key = ?
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (public_key,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "timestamp": row["timestamp"],
            "data": json.loads(row["data"]),
        }

    @staticmethod
    async def get_latest_all() -> dict[str, dict]:
        """Return the newest telemetry row per public_key: {pk: {timestamp, data}}."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT t.public_key AS public_key, t.timestamp AS timestamp, t.data AS data
                FROM repeater_telemetry_history t
                JOIN (
                    SELECT public_key, MAX(timestamp) AS ts
                    FROM repeater_telemetry_history
                    GROUP BY public_key
                ) m ON t.public_key = m.public_key AND t.timestamp = m.ts
                """
            ) as cursor:
                rows = await cursor.fetchall()
        return {
            row["public_key"]: {
                "timestamp": row["timestamp"],
                "data": json.loads(row["data"]),
            }
            for row in rows
        }
