from app.database import db
from app.models import TrackerObject, TrackerPosition

_POSITION_COLUMNS = (
    "source",
    "identity",
    "display_name",
    "team",
    "lat",
    "lon",
    "alt_m",
    "speed_mps",
    "course_deg",
    "battery_pct",
    "channel_key",
    "packet_id",
    "path_len",
    "received_at",
)
_OBJECT_COLUMNS = tuple(TrackerObject.model_fields)


def _window(since: int | None, until: int | None, column: str) -> tuple[list[str], list]:
    clauses: list[str] = []
    params: list = []
    if since is not None:
        clauses.append(f"{column} > ?")
        params.append(since)
    if until is not None:
        clauses.append(f"{column} <= ?")
        params.append(until)
    return clauses, params


class TrackerRepository:
    """Persistence for tracker positions and ATAK map objects (migration 157)."""

    @staticmethod
    async def add_position(p: TrackerPosition) -> int:
        values = tuple(getattr(p, c) for c in _POSITION_COLUMNS)
        async with db.tx() as conn:
            async with conn.execute(
                f"INSERT INTO tracker_positions ({', '.join(_POSITION_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_POSITION_COLUMNS))})",
                values,
            ) as cursor:
                return int(cursor.lastrowid or 0)

    @staticmethod
    async def has_position_for_packet(packet_id: int) -> bool:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT 1 FROM tracker_positions WHERE packet_id = ? LIMIT 1", (packet_id,)
            ) as cursor:
                return await cursor.fetchone() is not None

    @staticmethod
    async def upsert_object(o: TrackerObject) -> None:
        columns = ", ".join(_OBJECT_COLUMNS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in _OBJECT_COLUMNS if c != "uid")
        async with db.tx() as conn:
            async with conn.execute(
                f"INSERT INTO tracker_objects ({columns}) "
                f"VALUES ({', '.join('?' * len(_OBJECT_COLUMNS))}) "
                f"ON CONFLICT(uid) DO UPDATE SET {updates}",
                tuple(getattr(o, c) for c in _OBJECT_COLUMNS),
            ):
                pass

    @staticmethod
    async def positions(
        since: int | None,
        until: int | None,
        latest_per_identity: bool,
        source: str | None,
        limit: int,
    ) -> list[TrackerPosition]:
        """Positions received in (since, until], newest first."""
        clauses, params = _window(since, until, "received_at")
        if source is not None:
            clauses.append("source = ?")
            params.append(source)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        if latest_per_identity:
            sql = (
                "SELECT * FROM (SELECT *, ROW_NUMBER() OVER ("
                "PARTITION BY source, identity ORDER BY received_at DESC, id DESC) AS rn "
                f"FROM tracker_positions {where}) WHERE rn = 1 "
                "ORDER BY received_at DESC, id DESC LIMIT ?"
            )
        else:
            sql = f"SELECT * FROM tracker_positions {where} ORDER BY received_at DESC, id DESC LIMIT ?"
        async with db.readonly() as conn:
            async with conn.execute(sql, (*params, limit)) as cursor:
                rows = await cursor.fetchall()
        return [TrackerPosition(id=r["id"], **{c: r[c] for c in _POSITION_COLUMNS}) for r in rows]

    @staticmethod
    async def objects(
        since: int | None, until: int | None, include_stale: bool, now: int
    ) -> list[TrackerObject]:
        """Objects received in (since, until], newest first; stale ones only on request."""
        clauses, params = _window(since, until, "received_at")
        if not include_stale:
            clauses.append("(stale_at IS NULL OR stale_at >= ?)")
            params.append(now)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT * FROM tracker_objects {where} ORDER BY received_at DESC", params
            ) as cursor:
                rows = await cursor.fetchall()
        return [TrackerObject(**{c: r[c] for c in _OBJECT_COLUMNS}) for r in rows]
