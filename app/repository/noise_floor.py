from app.database import db


class NoiseFloorRepository:
    """Persistence for periodic noise-floor samples (noise_floor_samples)."""

    @staticmethod
    async def insert(timestamp: int, noise_floor_dbm: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO noise_floor_samples (timestamp, noise_floor_dbm) VALUES (?, ?)",
                (timestamp, noise_floor_dbm),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, noise_floor_dbm FROM noise_floor_samples "
                "WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {"timestamp": r["timestamp"], "noise_floor_dbm": r["noise_floor_dbm"]} for r in rows
        ]
