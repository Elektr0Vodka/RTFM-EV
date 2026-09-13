from app.database import db


class AirtimeHistoryRepository:
    """Persistence for periodic cumulative airtime samples (airtime_history)."""

    @staticmethod
    async def insert(timestamp: int, tx_air_secs: int, rx_air_secs: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO airtime_history (timestamp, tx_air_secs, rx_air_secs) VALUES (?, ?, ?)",
                (timestamp, tx_air_secs, rx_air_secs),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, tx_air_secs, rx_air_secs FROM airtime_history "
                "WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": r["timestamp"],
                "tx_air_secs": r["tx_air_secs"],
                "rx_air_secs": r["rx_air_secs"],
            }
            for r in rows
        ]
