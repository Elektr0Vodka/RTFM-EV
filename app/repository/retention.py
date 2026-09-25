"""SQL for the retention prune service and its stats endpoint.

Every table/column name used in formatted SQL comes from the fixed maps below,
never from caller input; ``_table_for`` rejects anything else.
"""

from app.database import db

# Retention key -> (table, timestamp column) for plain age-based pruning.
AGE_TABLES: dict[str, tuple[str, str]] = {
    "raw_packets": ("raw_packets", "timestamp"),
    "advert_events": ("advert_events", "first_seen"),
    "repeater_telemetry": ("repeater_telemetry_history", "timestamp"),
    "contact_telemetry": ("contact_telemetry_history", "timestamp"),
    "link_signal": ("link_signal", "observed_at"),
    "noise_floor": ("noise_floor_samples", "timestamp"),
    "battery": ("battery_history", "timestamp"),
    "airtime": ("airtime_history", "timestamp"),
    "messages": ("messages", "received_at"),
    "link_edges": ("link_edge_events", "ts"),
    "packet_receptions": ("packet_receptions", "observed_at"),
}

# Tables that also get a per-node row cap (newest kept).
TELEMETRY_TABLES: frozenset[str] = frozenset(
    {"repeater_telemetry_history", "contact_telemetry_history"}
)

# Stats-only entry: advert paths are trimmed by count, not age.
_ADVERT_PATHS = ("contact_advert_paths", "first_seen")


def _table_for(key: str) -> tuple[str, str]:
    if key not in AGE_TABLES:
        raise ValueError(f"Unknown retention key: {key}")
    return AGE_TABLES[key]


class RetentionRepository:
    @staticmethod
    async def prune_older_than(key: str, cutoff_ts: int) -> int:
        """Delete rows of ``key`` older than ``cutoff_ts``. Not for messages."""
        if key == "messages":
            raise ValueError("Use prune_messages_older_than for messages")
        table, column = _table_for(key)
        async with db.tx() as conn:
            async with conn.execute(
                f"DELETE FROM {table} WHERE {column} < ?", (cutoff_ts,)
            ) as cursor:
                return cursor.rowcount

    @staticmethod
    async def cap_rows_per_node(table: str, max_rows: int) -> int:
        """Keep only the newest ``max_rows`` telemetry rows per public_key."""
        if table not in TELEMETRY_TABLES:
            raise ValueError(f"Not a telemetry table: {table}")
        async with db.tx() as conn:
            async with conn.execute(
                f"""
                DELETE FROM {table} WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY public_key ORDER BY timestamp DESC, id DESC
                        ) AS rn
                        FROM {table}
                    ) WHERE rn > ?
                )
                """,
                (max_rows,),
            ) as cursor:
                return cursor.rowcount

    @staticmethod
    async def trim_advert_paths(max_paths: int) -> int:
        """Keep the ``max_paths`` most recent unique advert paths per contact.

        Ordering matches ``ContactAdvertPathRepository.record_observation``.
        """
        async with db.tx() as conn:
            async with conn.execute(
                """
                DELETE FROM contact_advert_paths WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY public_key
                            ORDER BY last_seen DESC, heard_count DESC, path_len ASC, path_hex ASC
                        ) AS rn
                        FROM contact_advert_paths
                    ) WHERE rn > ?
                )
                """,
                (max(1, max_paths),),
            ) as cursor:
                return cursor.rowcount

    @staticmethod
    async def prune_messages_older_than(cutoff_ts: int) -> tuple[int, int]:
        """Delete messages received before ``cutoff_ts`` and their linked raw packets.

        The linked raw packets go first, in the same transaction, so historical
        decryption cannot recreate a pruned message from its stored packet.
        Returns ``(messages_deleted, raw_packets_deleted)``.
        """
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM raw_packets WHERE message_id IN "
                "(SELECT id FROM messages WHERE received_at < ?)",
                (cutoff_ts,),
            ) as cursor:
                raw_deleted = cursor.rowcount
            async with conn.execute(
                "DELETE FROM messages WHERE received_at < ?", (cutoff_ts,)
            ) as cursor:
                return cursor.rowcount, raw_deleted

    @staticmethod
    async def count_messages_older_than(cutoff_ts: int) -> int:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) AS n FROM messages WHERE received_at < ?", (cutoff_ts,)
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row else 0

    @staticmethod
    async def stats() -> dict[str, dict[str, int | None]]:
        """Row count and oldest timestamp for every retention class."""
        entries = {**AGE_TABLES, "advert_paths": _ADVERT_PATHS}
        result: dict[str, dict[str, int | None]] = {}
        async with db.readonly() as conn:
            for key, (table, column) in entries.items():
                async with conn.execute(
                    f"SELECT COUNT(*) AS n, MIN({column}) AS oldest FROM {table}"
                ) as cursor:
                    row = await cursor.fetchone()
                result[key] = {
                    "rows": int(row["n"]) if row else 0,
                    "oldest_ts": int(row["oldest"]) if row and row["oldest"] is not None else None,
                }
        return result

    @staticmethod
    async def incremental_vacuum() -> None:
        """Return freed pages to the OS (the DB uses auto_vacuum=INCREMENTAL, _020)."""
        async with db.tx() as conn:
            # Each result row is one reclaimed page; step it to completion.
            async with conn.execute("PRAGMA incremental_vacuum") as cursor:
                await cursor.fetchall()
