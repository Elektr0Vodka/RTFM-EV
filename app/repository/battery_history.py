from app.database import db
from app.repository.radio_identities import StatScope


class BatteryHistoryRepository:
    """Persistence for periodic battery-voltage samples (battery_history)."""

    @staticmethod
    async def insert(timestamp: int, battery_mv: int, radio_identity_id: int | None = None) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO battery_history (timestamp, battery_mv, radio_identity_id) "
                "VALUES (?, ?, ?)",
                (timestamp, battery_mv, radio_identity_id),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int, scope: StatScope | None = None) -> list[dict]:
        where, params = (scope or StatScope()).where()
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, battery_mv FROM battery_history "
                f"WHERE timestamp >= ? AND timestamp <= ?{where} ORDER BY timestamp ASC",
                (start_ts, end_ts, *params),
            ) as cursor:
                rows = await cursor.fetchall()
        return [{"timestamp": r["timestamp"], "battery_mv": r["battery_mv"]} for r in rows]
