from app.database import db


class AirtimeHistoryRepository:
    """Persistence for periodic cumulative airtime + RX error samples (airtime_history)."""

    @staticmethod
    async def insert(
        timestamp: int, tx_air_secs: int, rx_air_secs: int, recv_errors: int | None = None
    ) -> None:
        """Store one sample. ``recv_errors`` is the cumulative radio RX error counter
        (firmware v1.12+ ``STATS_PACKETS``); None when the frame did not carry it."""
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO airtime_history (timestamp, tx_air_secs, rx_air_secs, recv_errors) "
                "VALUES (?, ?, ?, ?)",
                (timestamp, tx_air_secs, rx_air_secs, recv_errors),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, tx_air_secs, rx_air_secs, recv_errors FROM airtime_history "
                "WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": r["timestamp"],
                "tx_air_secs": r["tx_air_secs"],
                "rx_air_secs": r["rx_air_secs"],
                "recv_errors": r["recv_errors"],
            }
            for r in rows
        ]
