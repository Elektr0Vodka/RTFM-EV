import json
import logging

from app.database import db

logger = logging.getLogger(__name__)

_COLUMNS = (
    "id, antenna, notes, radio_public_key, radio_name, traces_per_node, "
    "started_at, finished_at, results"
)


def _row_to_dict(row) -> dict:
    data = dict(row)
    try:
        parsed = json.loads(data.get("results") or "[]")
    except json.JSONDecodeError:
        logger.warning("antenna_test_runs row %s has unreadable results", data.get("id"))
        parsed = []
    data["results"] = parsed if isinstance(parsed, list) else []
    return data


class AntennaTestRepository:
    """Finished antenna test runs (Trace page, Antenna test tab)."""

    @staticmethod
    async def create(
        *,
        antenna: str,
        notes: str,
        radio_public_key: str | None,
        radio_name: str | None,
        traces_per_node: int,
        started_at: int,
        finished_at: int,
        results: list[dict],
    ) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO antenna_test_runs (antenna, notes, radio_public_key, radio_name, "
                "traces_per_node, started_at, finished_at, results) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    antenna,
                    notes,
                    radio_public_key,
                    radio_name,
                    traces_per_node,
                    started_at,
                    finished_at,
                    json.dumps(results),
                ),
            ) as cursor:
                new_id = cursor.lastrowid
        if new_id is None:
            raise RuntimeError("antenna_test_runs insert returned no row id")
        return new_id

    @staticmethod
    async def list_all() -> list[dict]:
        """Every run, newest first."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM antenna_test_runs ORDER BY started_at DESC, id DESC"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_dict(row) for row in rows]

    @staticmethod
    async def get(run_id: int) -> dict | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM antenna_test_runs WHERE id = ?", (run_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_dict(row) if row else None

    @staticmethod
    async def delete(run_id: int) -> bool:
        async with db.tx() as conn:
            cursor = await conn.execute("DELETE FROM antenna_test_runs WHERE id = ?", (run_id,))
            deleted = cursor.rowcount > 0
        return deleted
