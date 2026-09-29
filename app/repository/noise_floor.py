from app.database import db
from app.repository.radio_identities import StatScope


class NoiseFloorRepository:
    """Persistence for periodic noise-floor samples (noise_floor_samples)."""

    @staticmethod
    async def insert(
        timestamp: int, noise_floor_dbm: int, radio_identity_id: int | None = None
    ) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO noise_floor_samples (timestamp, noise_floor_dbm, radio_identity_id) "
                "VALUES (?, ?, ?)",
                (timestamp, noise_floor_dbm, radio_identity_id),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int, scope: StatScope | None = None) -> list[dict]:
        where, params = (scope or StatScope()).where()
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, noise_floor_dbm FROM noise_floor_samples "
                f"WHERE timestamp >= ? AND timestamp <= ?{where} ORDER BY timestamp ASC",
                (start_ts, end_ts, *params),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {"timestamp": r["timestamp"], "noise_floor_dbm": r["noise_floor_dbm"]} for r in rows
        ]
