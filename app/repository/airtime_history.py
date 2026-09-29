from app.database import db
from app.repository.radio_identities import StatScope


class AirtimeHistoryRepository:
    """Persistence for periodic cumulative airtime + RX error samples (airtime_history)."""

    @staticmethod
    async def insert(
        timestamp: int,
        tx_air_secs: int,
        rx_air_secs: int,
        recv_errors: int | None = None,
        radio_identity_id: int | None = None,
    ) -> None:
        """Store one sample. ``recv_errors`` is the cumulative radio RX error counter
        (firmware v1.12+ ``STATS_PACKETS``); None when the frame did not carry it.
        ``radio_identity_id`` is the radio that produced the counters (plan 18)."""
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO airtime_history "
                "(timestamp, tx_air_secs, rx_air_secs, recv_errors, radio_identity_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (timestamp, tx_air_secs, rx_air_secs, recv_errors, radio_identity_id),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int, scope: StatScope | None = None) -> list[dict]:
        """Samples in the window, oldest first. Each carries ``radio_identity_id`` so
        the utilization math never takes a counter delta across two radios."""
        where, params = (scope or StatScope()).where()
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, tx_air_secs, rx_air_secs, recv_errors, radio_identity_id "
                "FROM airtime_history "
                f"WHERE timestamp >= ? AND timestamp <= ?{where} ORDER BY timestamp ASC",
                (start_ts, end_ts, *params),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": r["timestamp"],
                "tx_air_secs": r["tx_air_secs"],
                "rx_air_secs": r["rx_air_secs"],
                "recv_errors": r["recv_errors"],
                "radio_identity_id": r["radio_identity_id"],
            }
            for r in rows
        ]
