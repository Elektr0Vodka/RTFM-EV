from app.database import db


class BatteryHistoryRepository:
    """Persistence for periodic battery-voltage samples (battery_history)."""

    @staticmethod
    async def insert(timestamp: int, battery_mv: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO battery_history (timestamp, battery_mv) VALUES (?, ?)",
                (timestamp, battery_mv),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, battery_mv FROM battery_history "
                "WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [{"timestamp": r["timestamp"], "battery_mv": r["battery_mv"]} for r in rows]
