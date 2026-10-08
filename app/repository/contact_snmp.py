import json
import logging
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)

_COLUMNS = (
    "public_key, host, port, community, poll_enabled, poll_interval_minutes, "
    "last_ok_at, last_error, last_error_at, updated_at"
)


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "public_key": row["public_key"],
        "host": row["host"],
        "port": int(row["port"]),
        "community": row["community"],
        "poll_enabled": bool(row["poll_enabled"]),
        "poll_interval_minutes": int(row["poll_interval_minutes"]),
        "last_ok_at": row["last_ok_at"],
        "last_error": row["last_error"],
        "last_error_at": row["last_error_at"],
        "updated_at": row["updated_at"],
    }


class ContactSnmpRepository:
    """Per-contact SNMP polling settings (table ``contact_snmp``).

    Rows carry the SNMP community. Callers must not pass a row to the browser,
    the WebSocket or a fanout module as is.
    """

    @staticmethod
    async def get(public_key: str) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM contact_snmp WHERE public_key = ?", (public_key,)
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_dict(row) if row else None

    @staticmethod
    async def upsert(
        public_key: str,
        *,
        host: str,
        port: int,
        community: str,
        poll_enabled: bool,
        poll_interval_minutes: int,
        now: int,
    ) -> None:
        """Insert or replace the settings. Poll outcome columns are kept."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO contact_snmp
                    (public_key, host, port, community, poll_enabled,
                     poll_interval_minutes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(public_key) DO UPDATE SET
                    host = excluded.host,
                    port = excluded.port,
                    community = excluded.community,
                    poll_enabled = excluded.poll_enabled,
                    poll_interval_minutes = excluded.poll_interval_minutes,
                    updated_at = excluded.updated_at
                """,
                (
                    public_key,
                    host,
                    port,
                    community,
                    int(poll_enabled),
                    poll_interval_minutes,
                    now,
                ),
            ):
                pass

    @staticmethod
    async def delete(public_key: str) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM contact_snmp WHERE public_key = ?", (public_key,)
            ) as cursor:
                return cursor.rowcount > 0

    @staticmethod
    async def record_ok(public_key: str, timestamp: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE contact_snmp
                   SET last_ok_at = ?, last_error = NULL, last_error_at = NULL
                 WHERE public_key = ?
                """,
                (timestamp, public_key),
            ):
                pass

    @staticmethod
    async def record_error(public_key: str, timestamp: int, error: str) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE contact_snmp SET last_error = ?, last_error_at = ? WHERE public_key = ?",
                (error[:500], timestamp, public_key),
            ):
                pass

    @staticmethod
    async def list_poll_enabled() -> list[dict[str, Any]]:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM contact_snmp WHERE poll_enabled = 1 ORDER BY public_key"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_dict(row) for row in rows]

    @staticmethod
    async def list_overview(*, default_community: str) -> list[dict[str, Any]]:
        """Every contact with SNMP settings, with its name and type, by name.

        Made for the browser: the community is not selected, only whether it
        equals ``default_community``.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT s.public_key, c.name, c.type, s.host, s.port,
                       s.community = ? AS community_is_default,
                       s.poll_enabled, s.poll_interval_minutes,
                       s.last_ok_at, s.last_error, s.last_error_at
                  FROM contact_snmp s
                  LEFT JOIN contacts c ON c.public_key = s.public_key
                 ORDER BY c.name COLLATE NOCASE, s.public_key
                """,
                (default_community,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "public_key": row["public_key"],
                "name": row["name"],
                "type": row["type"],
                "host": row["host"],
                "port": int(row["port"]),
                "community_is_default": bool(row["community_is_default"]),
                "poll_enabled": bool(row["poll_enabled"]),
                "poll_interval_minutes": int(row["poll_interval_minutes"]),
                "last_ok_at": row["last_ok_at"],
                "last_error": row["last_error"],
                "last_error_at": row["last_error_at"],
            }
            for row in rows
        ]


class SnmpHistoryRepository:
    """Stored SNMP poll results (table ``snmp_history``), one row per good poll.

    Rows are pruned by age with the telemetry retention class
    (``app/services/retention_pruner.py``).
    """

    @staticmethod
    async def record(public_key: str, timestamp: int, values: dict[str, Any]) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO snmp_history (public_key, timestamp, data) VALUES (?, ?, ?)",
                (public_key, timestamp, json.dumps(values)),
            ):
                pass

    @staticmethod
    async def get_latest(public_key: str) -> dict[str, Any] | None:
        """The newest stored poll of a contact, or None."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT timestamp, data FROM snmp_history
                 WHERE public_key = ?
                 ORDER BY timestamp DESC, id DESC
                 LIMIT 1
                """,
                (public_key,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        try:
            values = json.loads(row["data"])
        except (TypeError, ValueError):
            return None
        if not isinstance(values, dict):
            return None
        return {"timestamp": row["timestamp"], "values": values}

    @staticmethod
    async def get_history(
        public_key: str,
        since_timestamp: int,
        *,
        max_points: int,
        until_timestamp: int | None = None,
    ) -> list[dict[str, Any]]:
        """Rows since ``since_timestamp`` (up to ``until_timestamp`` when
        given, both inclusive), oldest first.

        When there are more than ``max_points`` rows, every n-th row is
        returned (the newest row always included) so a long range stays a
        bounded payload.
        """
        query = "SELECT timestamp, data FROM snmp_history WHERE public_key = ? AND timestamp >= ?"
        params: list[Any] = [public_key, since_timestamp]
        if until_timestamp is not None:
            query += " AND timestamp <= ?"
            params.append(until_timestamp)
        async with db.readonly() as conn:
            async with conn.execute(query + " ORDER BY timestamp ASC, id ASC", params) as cursor:
                rows = list(await cursor.fetchall())
        if max_points > 0 and len(rows) > max_points:
            stride = -(-len(rows) // max_points)
            # Walk back from the newest row so it is always kept.
            rows = rows[::-1][::stride][::-1]
        result: list[dict[str, Any]] = []
        for row in rows:
            try:
                values = json.loads(row["data"])
            except (TypeError, ValueError):
                continue
            if isinstance(values, dict):
                result.append({"timestamp": row["timestamp"], "values": values})
        return result
