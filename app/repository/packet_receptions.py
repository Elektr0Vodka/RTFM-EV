"""Repository for ``packet_receptions`` (plan 21 S1): one row per received copy.

``raw_packets`` keeps one row per payload; this table keeps one row per
physical reception of a flood-routed copy so the same packet can be compared
across the relays that delivered it. Pruned by ``packet_reception_retention_days``
(see ``app/repository/retention.py``).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.database import db


@dataclass(frozen=True)
class PacketReceptionRow:
    id: int
    raw_packet_id: int | None
    payload_hash: bytes
    observed_at: int
    snr: float | None
    rssi: int | None
    payload_type: str
    route_type: str
    hop_count: int
    hash_size: int
    last_hop_hex: str | None
    path_hex: str | None


_COLUMNS = (
    "id, raw_packet_id, payload_hash, observed_at, snr, rssi, payload_type, "
    "route_type, hop_count, hash_size, last_hop_hex, path_hex"
)


def _row_to_model(row) -> PacketReceptionRow:
    return PacketReceptionRow(
        id=row["id"],
        raw_packet_id=row["raw_packet_id"],
        payload_hash=bytes(row["payload_hash"]),
        observed_at=row["observed_at"],
        snr=row["snr"],
        rssi=row["rssi"],
        payload_type=row["payload_type"],
        route_type=row["route_type"],
        hop_count=row["hop_count"],
        hash_size=row["hash_size"],
        last_hop_hex=row["last_hop_hex"],
        path_hex=row["path_hex"],
    )


class PacketReceptionRepository:
    @staticmethod
    async def insert(
        *,
        raw_packet_id: int | None,
        payload_hash: bytes,
        observed_at: int,
        snr: float | None,
        rssi: int | None,
        payload_type: str,
        route_type: str,
        hop_count: int,
        hash_size: int,
        last_hop_hex: str | None,
        path_hex: str | None,
    ) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO packet_receptions (raw_packet_id, payload_hash, observed_at, snr, "
                "rssi, payload_type, route_type, hop_count, hash_size, last_hop_hex, path_hex) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    raw_packet_id,
                    payload_hash,
                    observed_at,
                    snr,
                    rssi,
                    payload_type,
                    route_type,
                    hop_count,
                    hash_size,
                    last_hop_hex,
                    path_hex,
                ),
            ) as cursor:
                return int(cursor.lastrowid or 0)

    @staticmethod
    async def window_rows(
        start_ts: int, end_ts: int, limit: int = 5000
    ) -> list[PacketReceptionRow]:
        """Receptions observed in ``[start_ts, end_ts]``, newest first, capped."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM packet_receptions "
                "WHERE observed_at >= ? AND observed_at <= ? "
                "ORDER BY observed_at DESC, id DESC LIMIT ?",
                (start_ts, end_ts, limit),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_model(row) for row in rows]

    @staticmethod
    async def message_previews(raw_packet_ids: list[int]) -> dict[int, tuple[int, str]]:
        """``raw_packet_id -> (message_id, text)`` for the copies that decrypted to a message."""
        if not raw_packet_ids:
            return {}
        placeholders = ",".join("?" for _ in raw_packet_ids)
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT r.id AS raw_id, m.id AS message_id, m.text AS text "
                "FROM raw_packets r JOIN messages m ON m.id = r.message_id "
                f"WHERE r.id IN ({placeholders})",
                tuple(raw_packet_ids),
            ) as cursor:
                rows = await cursor.fetchall()
        return {int(row["raw_id"]): (int(row["message_id"]), row["text"] or "") for row in rows}

    @staticmethod
    async def count() -> int:
        async with db.readonly() as conn:
            async with conn.execute("SELECT COUNT(*) AS n FROM packet_receptions") as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row else 0
