"""Sensor telemetry push subscriptions (MeshCore 1.18 ``SensorMesh`` REQ_TYPE_SUBSCRIBE)."""

import json
from typing import Any

from app.database import db


def _row(row: Any) -> dict:
    data = dict(row)
    data["enabled"] = bool(data["enabled"])
    data["thresholds"] = json.loads(data["thresholds"] or "[]")
    return data


class SensorPushRepository:
    @staticmethod
    async def get(public_key: str) -> dict | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM sensor_push_subscriptions WHERE public_key = ?",
                (public_key.lower(),),
            ) as cursor:
                row = await cursor.fetchone()
        return _row(row) if row else None

    @staticmethod
    async def save_config(public_key: str, thresholds: list[dict], now: int) -> None:
        """Store the thresholds; keeps the enabled flag and subscription state."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO sensor_push_subscriptions (public_key, thresholds, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(public_key) DO UPDATE SET
                    thresholds = excluded.thresholds, updated_at = excluded.updated_at
                """,
                (public_key.lower(), json.dumps(thresholds), now),
            ):
                pass

    @staticmethod
    async def set_enabled(public_key: str, enabled: bool, now: int) -> None:
        """Turn push on or off; turning it off forgets the sensor's grant."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO sensor_push_subscriptions (public_key, enabled, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(public_key) DO UPDATE SET
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at,
                    granted_until = CASE WHEN excluded.enabled THEN granted_until ELSE NULL END
                """,
                (public_key.lower(), 1 if enabled else 0, now),
            ):
                pass

    @staticmethod
    async def mark_attempt(public_key: str, push_tag: str, now: int) -> None:
        """Record the tag sent in a subscribe attempt before the reply comes back."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE sensor_push_subscriptions
                SET push_tag = ?, last_attempt_at = ?, updated_at = ?
                WHERE public_key = ?
                """,
                (push_tag.lower(), now, now, public_key.lower()),
            ):
                pass

    @staticmethod
    async def set_granted(
        public_key: str, push_tag: str, granted_until: int, scope_name: str, now: int
    ) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE sensor_push_subscriptions
                SET push_tag = ?, granted_until = ?, scope_name = ?, last_error = NULL,
                    updated_at = ?
                WHERE public_key = ?
                """,
                (push_tag.lower(), granted_until, scope_name, now, public_key.lower()),
            ):
                pass

    @staticmethod
    async def set_error(public_key: str, error: str, now: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE sensor_push_subscriptions
                SET last_error = ?, last_attempt_at = ?, updated_at = ?
                WHERE public_key = ?
                """,
                (error, now, now, public_key.lower()),
            ):
                pass

    @staticmethod
    async def find_enabled_by_tag(push_tag: str) -> dict | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM sensor_push_subscriptions WHERE push_tag = ? AND enabled = 1",
                (push_tag.lower(),),
            ) as cursor:
                row = await cursor.fetchone()
        return _row(row) if row else None

    @staticmethod
    async def list_enabled() -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM sensor_push_subscriptions WHERE enabled = 1 ORDER BY public_key"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row(r) for r in rows]

    @staticmethod
    async def record_push(public_key: str, now: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE sensor_push_subscriptions SET last_push_at = ? WHERE public_key = ?",
                (now, public_key.lower()),
            ):
                pass
