"""Damaged frames from Full capture (meshcomod) and its saved switch.

Rows come from ``app/services/full_capture.py``; they never enter
``raw_packets``. Pruned after a fixed 7 days by the retention pruner.
"""

from app.database import db


class RxBadFrameRepository:
    @staticmethod
    async def create(
        timestamp: int, status: int, data: bytes, rssi: int | None, snr: float | None
    ) -> int:
        async with db.tx() as conn:
            cursor = await conn.execute(
                "INSERT INTO rx_bad_frames (timestamp, status, length, rssi, snr, data) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (timestamp, status, len(data), rssi, snr, data),
            )
            row_id = cursor.lastrowid
        assert row_id is not None
        return row_id

    @staticmethod
    async def get_flags() -> int:
        """Which kinds of frames the radio is asked to pass on (0 = Full capture off)."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT full_capture_flags FROM app_settings WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    @staticmethod
    async def set_flags(flags: int) -> None:
        async with db.tx() as conn:
            await conn.execute(
                "UPDATE app_settings SET full_capture_flags = ? WHERE id = 1", (flags,)
            )
